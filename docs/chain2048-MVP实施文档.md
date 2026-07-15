# Chain2048 — MVP 实施文档（可执行版）

> 配套原需求文档 `chain2048-需求文档.md`。原文档定方向，本文档定实现：所有数据结构、算法、接口、任务均为最终决定，照做即可，无需再做设计决策。
> 任务编号 T1–T18，按顺序执行；每个任务有明确的产出和验收标准，验收通过才进入下一个。

---

## 0. 全局决定（不再讨论）

| 决定项 | 结论 |
|---|---|
| 链 | Monad 测试网（chainId `10143`，RPC `https://testnet-rpc.monad.xyz`，浏览器 `https://testnet.monadexplorer.com`，水龙头 `https://faucet.monad.xyz`）※ 以官方文档实测为准，T12 验证 |
| 当前测试网合约 | 安全加固 V2.3 `0x77Edd2DE70e55bEC89D3412B409a6C788Cf95E31`（2026-07-15 部署，单会话上限 5 MON、垫资 0.5 MON）；V2.2 `0x6DbdAC842321491C91fd9bc869AbfFF7316ff1e1`、V2.1 `0x50B58D39e3FD285C1F1Fb52874acA46334e27A4E`、V2 `0x08D370C799c2223D4aC743db0e95d0bd438404A6` 和 V1 `0xF0beD36a9dF26C546A8df72F27BECa1642d41C78` 已废弃 |
| 当前源码版本 | V2.3：预存 1–5 MON、会话垫资 0.5 MON、单步返还上限 0.1 MON |
| 合约语言/框架 | Solidity ^0.8.24 + Foundry（仓库已初始化） |
| 合约文件 | 单文件 `src/Game2048.sol`，不拆库 |
| 前端 | React 18 + Vite + TypeScript + wagmi v2 + viem，目录 `web/`，纯 SPA |
| 棋盘编码 | 一个 `uint256`，16 个 4-bit 格子。格子 `i = row*4 + col`（row 0 在最上），占 bit `[4i, 4i+4)`。值存 2 的指数：`0`=空，`1`=2，`2`=4 … `15`=32768（封顶，合成 32768 后不再合并该格） |
| 方块 PRNG | `keccak256(abi.encode(gameId, moveCount, movedBoard))`；确定、可前端复现、不受出块者影响，但不得用于奖金或资产结算 |
| 一局限制 | 每个 owner 同时最多一局进行中；开新局自动废弃旧局（旧局分数已在每次 move 时同步，不丢） |
| 会话密钥 | 按登录钱包隔离，仅驻留当前页面内存；不写任何浏览器持久化存储；24 小时过期、单会话、可链上撤销 |
| gas 来源 | 登录钱包可输入 1–5 MON；会话垫资 0.5 MON；只返还 move，单步上限 0.1 MON，单会话上限 5 MON |
| 紧急权限 | `SECURITY_ADMIN` 应为多签；可暂停授权/充值/开局/移动；撤销会话与取回预存永不被暂停 |

---

## 1. 游戏规则精确规范（合约与前端本地引擎共用，必须逐条一致）

以「向左滑」为基准定义，其余方向通过行/列变换归约到向左：

- **向左**：逐行处理，行内从左到右。
- **向右**：行内元素反转 → 按向左处理 → 反转回来。
- **向上**：转置（`board[r][c] ↔ board[c][r]`）→ 按向左处理 → 转置回来。
- **向下**：转置 → 按向右处理 → 转置回来。

单行处理算法（输入 4 个格子值 a[0..3]，输出新行 + 本行得分）：

```
1. 压缩：去掉 0，非零值保持顺序靠左。
2. 合并：从左到右扫描，若 a[i] != 0 且 a[i] == a[i+1] 且 a[i] < 15：
     a[i] += 1（指数+1）；a[i+1] = 0；score += 2^a[i]（合并后的面值）；i += 2（跳过，一格一次滑动最多合并一次）
   否则 i += 1。
3. 再压缩：去掉合并产生的 0。
4. 不足 4 格补 0。
```

规则裁定（测试用例直接对照）：

| 场景（指数写法） | 向左结果 | 得分增量 |
|---|---|---|
| `[1,1,1,1]`（2,2,2,2） | `[2,2,0,0]`（4,4） | 8 |
| `[1,1,2,0]`（2,2,4） | `[2,2,0,0]`（4,4）——合并出的 4 **不**与原有的 4 二次合并 | 4 |
| `[2,1,1,0]`（4,2,2） | `[2,2,0,0]`（4,4） | 4 |
| `[1,0,0,1]`（2,_,_,2） | `[2,0,0,0]`（4） | 4 |
| `[1,2,1,2]` | 不变 | 0（若四方向全不变 → 该方向 revert） |
| `[15,15,0,0]`（32768,32768） | 不变（封顶不合并） | 0 |

- **合法移动判定**：移动后 `board != 旧 board` 才合法；否则 `revert NoMove()`。
- **新方块生成**（仅合法移动后）：随机选一个空格，90% 概率放指数 1（面值 2），10% 概率放指数 2（面值 4）。随机源见 §0。开局生成 2 个初始方块，同样规则。
- **结束判定**：无空格 **且** 任意相邻（上下左右）格子值都不相等 → `gameOver = true`，锁定，后续 `move` revert `GameIsOver()`。
- **胜利判定**：不做。合成 2048 不弹窗不停局，继续玩（前端可仅展示最大方块）。

---

## 2. 合约最终规范 `src/Game2048.sol`

### 2.1 存储

```solidity
enum Direction { Up, Down, Left, Right }   // 0,1,2,3

struct Game {
    address owner;      // 主钱包地址
    uint256 board;      // 16×4bit 打包
    uint256 score;
    uint32  moveCount;
    bool    over;
}

uint256 public nextGameId;                          // 从 1 开始
mapping(uint256 => Game) public games;
mapping(address => address) public sessionToOwner;  // 会话地址 → 主钱包
mapping(address => address) public activeSessionOf; // owner → 唯一有效会话
mapping(address => uint64) public sessionExpiresAt;
mapping(address => uint256) public sessionRefundRemaining;
mapping(address => uint256) public activeGameOf;    // owner → 进行中的 gameId（0=无）
mapping(address => uint256) public highScore;       // owner → 历史最高分
mapping(address => uint256) public gasBalance;      // owner → 预存的会话 gas 返还额度
```

### 2.2 外部接口（签名不再改动，前端按此写 ABI 调用）

```solidity
/// 主钱包调用。覆盖旧会话，授权 24 小时并设置返还上限。
function authorizeSession(address sessionKey) external payable;

/// 主钱包追加充值：先补足会话启动金，剩余进入 gasBalance。
function fundSession(address sessionKey) external payable;

function depositGas() external payable;
function withdrawGas(uint256 amount) external;
function revokeSession() external;

/// 仅登录钱包调用；会话不得替 owner 开局。
function startGame() external returns (uint256 gameId);

/// 会话密钥调用。核心函数。
function move(uint256 gameId, Direction dir) external;

/// 任意人可读。
function getBoard(uint256 gameId) external view
    returns (uint8[16] memory cells, uint256 score, bool over);
```

### 2.3 事件与错误

```solidity
event SessionAuthorized(address indexed owner, address indexed sessionKey, uint64 expiresAt, uint256 refundLimit);
event SessionRevoked(address indexed owner, address indexed sessionKey);
event GasDeposited(address indexed owner, uint256 amount);
event GasWithdrawn(address indexed owner, uint256 amount);
event GasRefunded(address indexed owner, address indexed sessionKey, uint256 amount);
event GameStarted(uint256 indexed gameId, address indexed owner, uint256 board);
event Moved(uint256 indexed gameId, Direction dir, uint256 board, uint256 score, uint32 moveCount, bool over);
event PauseChanged(bool paused);
// board 直接放事件里 → 前端对账只解析事件，无需额外 eth_call

error NotAuthorized();   // msg.sender 无会话映射，或 game.owner 对不上
error NoActiveGame();    // gameId 不存在
error GameIsOver();
error NoMove();          // 该方向滑动棋盘无变化
```

### 2.4 `move()` 执行顺序（伪代码，照序实现）

```
1. 检查 msg.sender 是 owner 的 activeSessionOf、未过期且合约未暂停
2. g = games[gameId]; g.owner == 0 → revert NoActiveGame()
3. g.owner != owner → revert NotAuthorized()
4. g.over → revert GameIsOver()
5. (newBoard, gained) = applyMove(g.board, dir)     // §1 算法，纯函数
6. newBoard == g.board → revert NoMove()
7. newBoard = spawnTile(newBoard, rand)             // §1 新方块
8. g.board = newBoard; g.score += gained; g.moveCount += 1
9. if (isGameOver(newBoard)) { g.over = true; activeGameOf[owner] = 0;
       if (g.score > highScore[owner]) highScore[owner] = g.score; }
10. emit Moved(...)
11. 返还量同时受实际测算值、单步上限、会话剩余限额和 owner 预存余额限制
```

注意：第 9 步外，**每次 move 都顺手更新 highScore**（`if g.score > highScore[owner]`），这样弃局/换局不丢最高分，且省去 F8 排行榜的大半工作。

### 2.5 内部纯函数（全部 `internal pure`，便于 fuzz 测试）

```solidity
function getCell(uint256 board, uint256 i) internal pure returns (uint8);
function setCell(uint256 board, uint256 i, uint8 v) internal pure returns (uint256);
function applyMove(uint256 board, Direction dir) internal pure returns (uint256 newBoard, uint256 gained);
function slideRowLeft(uint8[4] memory row) internal pure returns (uint8[4] memory, uint256 gained);
function isGameOver(uint256 board) internal pure returns (bool);
function countEmpty(uint256 board) internal pure returns (uint256);
```

---

## 3. 前端最终规范 `web/`

### 3.1 目录结构

```
web/src/
  main.tsx / App.tsx
  config/chain.ts        // Monad 测试网 chain 定义、合约地址、ABI
  lib/engine.ts          // §1 规则的 TS 实现（与合约逐条对齐，供乐观更新）
  lib/session.ts         // 按 owner 隔离的页面内存会话，不做持久化
  lib/txQueue.ts         // 串行交易队列（见 3.3）
  hooks/useGame.ts       // 链上状态 + 乐观状态合并
  components/
    ConnectBar.tsx       // 连接钱包 + 会话状态 + 会话地址余额告警
    Board.tsx / Tile.tsx // 4×4 渲染 + CSS transform 动画
    ScorePanel.tsx       // 当前分 / 最高分 / pending 笔数
    GameOverOverlay.tsx  // 终局遮罩 + 「再来一局」
```

### 3.2 关键流程

**首次进入：**
1. wagmi 连接钱包（MetaMask/OKX，injected connector 即可，不接 WalletConnect）。
2. 以登录地址为 key 在页面内存生成会话；刷新页面不恢复旧私钥。
3. 同时读取 `sessionToOwner`、`activeSessionOf`、`sessionExpiresAt`、`sessionRefundRemaining` 和 `paused`；任一安全接口不存在则拒绝运行。
4. 登录钱包调用 `authorizeSession`，自由输入并预存 1–5 MON。
5. 登录钱包调用 `startGame()` 并确认；后续 `move()` 由会话静默发出。
6. 页面必须提供「撤销会话」和「取回预存」入口。

**每次滑动：**
1. 键盘方向键 / 触摸滑动（阈值 30px）触发。
2. 本地 `engine.applyPredictedMove()`：若无变化 → 抖动动画，**不发交易**（前端先挡掉 NoMove）。
3. 有变化 → 按合约同样的 PRNG 精确生成新方块并立即渲染，不等待 RPC。
4. 移动指令进入最多 12 步的缓冲区；交易以连续 nonce 按顺序快速广播，不等待上一笔 receipt。
5. `Moved` 回执按 nonce 顺序对账；队列清空后用最新事件 board 覆盖预测状态。

### 3.3 交易队列 `txQueue.ts`（防 nonce 冲突的最终方案）

- 初始化时以 `pending` block tag 读取会话地址的基准 nonce，之后本地自增。
- 发送串行：等 RPC 接受 nonce N 后立即广播 N+1，不等 N 出 receipt。
- 确认串行：receipt 按指令顺序解析，避免旧回执覆盖新状态。
- 缓冲上限 12 步；达到上限时暂停接收新输入，任一 receipt 完成后继续开放。
- 单笔 revert 只记录错误并继续后续 nonce；队列清空后统一以链上 `getBoard` 恢复权威状态。

---

## 4. 任务清单（按序执行，√ 一个做一个）

### 阶段 A：合约核心（对应原文档 F1/F2/F3，里程碑周一–周二）

| # | 任务 | 产出 | 验收标准 |
|---|---|---|---|
| T1 | 清理脚手架 | 删除 `Counter.sol/.s.sol/.t.sol`，建空 `Game2048.sol` 骨架（存储+接口签名+revert 占位） | `forge build` 通过 |
| T2 | 位操作工具 | `getCell/setCell/countEmpty` | 新建 `test/Board.t.sol`：设/取 16 格全遍历、边界值 0 和 15，测试全绿 |
| T3 | 单行合并 | `slideRowLeft` | §1 表格 6 个用例逐一断言 + fuzz：任意 4 值输入，输出非零值顺序稳定、总和守恒（指数域换算后） |
| T4 | 四方向归约 | `applyMove` | 每个方向 ≥2 个手工用例；对称性 fuzz：随机棋盘向左结果 == 水平翻转后向右再翻转回来 |
| T5 | 开局+新方块 | `startGame` 内部逻辑、`spawnTile`、随机数 | 开局恰好 2 个非空格且值 ∈ {1,2}；spawn 只落在空格（fuzz 1000 次） |
| T6 | move 主函数+结束判定 | `move()` 完整 10 步流程、`isGameOver` | 非法方向 revert NoMove；终局棋盘（手工构造无可动局面）再 move revert GameIsOver；highScore 随 move 更新 |

### 阶段 B：会话授权 + 部署（F4/F7，周三）

| # | 任务 | 产出 | 验收标准 |
|---|---|---|---|
| T7 | 会话授权 | `authorizeSession` + move/startGame 的 owner 校验 | 未授权地址调 move → NotAuthorized；重复授权覆盖旧 key；测试全绿 |
| T8 | 集成与安全测试 | 完整对局 + 过期/撤销/替换/暂停/gas 限额/管理员交接 | 游戏流程正确；会话泄漏的最大资金影响被限制在授权额度内 |
| T9 | 部署脚本 | `script/Deploy.s.sol` + `.env.example`（RPC、私钥占位） | 本地 anvil 跑通部署 |
| T10 | 安全版测试网部署 | V2 + 多签 `SECURITY_ADMIN` | 验证会话常量、暂停、管理员、撤销和取回；新地址写入 README/前端 |

### 阶段 C：前端（F5/F6，周四–周五）

| # | 任务 | 产出 | 验收标准 |
|---|---|---|---|
| T11 | 脚手架 | `web/` Vite+TS+wagmi 初始化，`config/chain.ts` 含 Monad 定义与 ABI | `pnpm dev` 起页面，能连 MetaMask 并显示地址 |
| T12 | 本地引擎 | `lib/engine.ts` | 用 vitest 移植 T3/T4 全部用例，与合约行为逐条一致 |
| T13 | 会话流 | 内存密钥、限时授权、撤销、取回、余额/限额告警 | 不存在浏览器持久化私钥；切换 owner 会话隔离；刷新后必须重新授权 |
| T14 | 棋盘渲染+输入 | Board/Tile/ScorePanel，键盘+触摸 | 读链上局面正确渲染；方向键触发本地预演动画 |
| T15 | 交易队列+对账 | `txQueue.ts` + useGame 本地优先合并 | 可连续输入最多 12 步；交易以连续 nonce 广播；receipt 按顺序对账；断网/revert 后能从链上状态恢复 |
| T16 | 终局+再来一局 | GameOverOverlay | 终局显示分数与 highScore；「再来一局」必须由登录钱包确认 |

### 阶段 D：交付（周六–周日）

| # | 任务 | 产出 | 验收标准 |
|---|---|---|---|
| T17 | 端到端演示验证 | 按 §5 演示脚本完整走一遍并录屏 | 录屏覆盖：连接→授权/预存→owner 开局→连续滑动 15+ 步无弹窗→撤销与取回 |
| T18 | README + pitch | 部署地址、架构图、已知取舍（随机数/防刷/密钥安全）、运行步骤 | 新人按 README 能本地跑起前端并连测试网玩 |

P1（F8 排行榜 Top N、F9 每日挑战）：**不在本清单**。highScore 已在 T6 免费获得，若周六有余量，加一个 `LeaderboardUpdated` 事件 + 前端事件扫描即可，不改存储。

---

## 5. 演示脚本（T17 逐字照做）

1. 打开网页，点「连接钱包」，选 MetaMask。
2. 授权 24 小时内存会话并按需预存 1–5 MON。
3. 登录钱包再确认一次 `startGame`；会话不具备开局权限。
4. 连续滑动 15+ 步：移动无弹窗，展示剩余返还限额。
5. 打开区块浏览器，展示连续的 move 交易列表。
6. 玩到终局（或口头说明），展示分数写入 highScore。
7. 展示 `forge test` 全绿输出。

## 6. 安全上线门槛

- 前端必须检测安全版合约接口；旧地址不得降级运行。
- 生产 CDN/托管层必须实际返回 `web/public/_headers`，并用浏览器网络面板复核 CSP。
- `SECURITY_ADMIN` 必须为多签；紧急演练要覆盖暂停、撤销、取回和管理员两步交接。
- 合约不得承载与分数或 PRNG 相关的奖金、抽奖、NFT 铸造权或可兑换资产。
- 任何真实价值资金进入合约前，需要独立安全审计和公开漏洞响应联系方式。

## 7. 硬性检查点（每天下班前自问）

- 周二晚：`forge test` 全绿且覆盖 §1 全部裁定用例？没有 → 砍 T5 随机数为固定位置生成，先保 move 正确。
- 周三晚：测试网上能用 cast 手动玩一步？没有 → 周四上午优先修，前端顺延。
- 周四晚：浏览器里能滑动且上链？没有 → 砍动画（T14 只做瞬时渲染），保 T15 队列。
- 周五晚：录一版保底 demo，之后的打磨都是加分项。
