# Chain2048

[![CI](https://github.com/Yunshiro/2048-onchain/actions/workflows/test.yml/badge.svg)](https://github.com/Yunshiro/2048-onchain/actions/workflows/test.yml)
[![Solidity](https://img.shields.io/badge/Solidity-0.8.24-363636?logo=solidity)](https://soliditylang.org/)
[![Monad Testnet](https://img.shields.io/badge/Monad-Testnet-836EF9)](https://testnet.monadexplorer.com/)

一个运行在 Monad 测试网上的全链 2048。棋盘、分数、移动次数和最高分均由 Solidity 合约维护；前端采用本地乐观演算与会话钱包静默签名，让连续移动保持接近本地游戏的响应速度。

> 当前版本是测试网 MVP，尚未经过独立第三方安全审计。请勿在未经审计的情况下用于托管高价值资产。

## 当前部署

| 项目 | 值 |
| --- | --- |
| 网络 | Monad Testnet |
| Chain ID | `10143` |
| 合约版本 | V2.3 |
| 合约地址 | [`0x77Edd2DE70e55bEC89D3412B409a6C788Cf95E31`](https://testnet.monadexplorer.com/address/0x77Edd2DE70e55bEC89D3412B409a6C788Cf95E31) |
| 单次预存 | 1–5 MON |
| 会话启动垫资 | 0.5 MON |
| 单步返还上限 | 0.1 MON |
| 会话有效期 | 24 小时 |

前端默认连接这个 V2.3 地址。旧版或无效合约不会降级运行；RPC 超时、限流和 TLS 错误也不会再被误判为旧合约。

## 功能

- 4 × 4 棋盘压缩进一个 `uint256`，每格使用 4 bit。
- Solidity 实现上、下、左、右移动与合并，最高支持 32768。
- 游戏状态、当前分数、历史最高分和终局状态持久化在链上。
- 登录钱包负责授权、开局、补充 MON、撤销会话和取回预存。
- 临时会话钱包只能移动，24 小时自动过期，并受单步与总返还额度限制。
- 前端立即预测并渲染移动，后台按连续 nonce 广播，最多缓冲 12 步。
- 回执按顺序处理，队列结束后自动与链上棋盘对账。
- 支持键盘、方向按钮和移动端滑动操作。
- Web3 赛博朋克界面，包含滑动、合并、同步和失败反馈动效。
- 合约支持紧急暂停与安全管理员两步交接。

## 工作方式

```text
玩家输入
   │
   ├── 前端立即计算下一棋盘并渲染
   │
   └── 会话钱包将 move 交易加入 nonce 队列
              │
              ▼
        Monad 测试网合约
              │
              ├── 校验会话、游戏归属和移动结果
              ├── 更新棋盘、分数与移动次数
              └── 发出 Moved 事件
                         │
                         ▼
                 前端按回执对账
```

方块生成使用：

```solidity
keccak256(abi.encode(gameId, moveCount, movedBoard))
```

因此前端能够精确复现合约结果。这个算法是可预测的游戏 PRNG，不能用于奖金、抽奖或可兑换资产；涉及经济激励时应改用 VRF 或 commit-reveal。

## 技术栈

### 合约

- Solidity 0.8.24
- Foundry / Forge
- forge-std

### 前端

- React 18
- TypeScript
- Vite
- wagmi + viem
- TanStack Query
- Motion
- Vitest

## 快速开始

### 环境要求

- [Foundry](https://book.getfoundry.sh/getting-started/installation)
- Node.js 22+
- pnpm 11.7+
- 一个支持 Monad Testnet 的浏览器钱包

### 克隆项目

```bash
git clone --recurse-submodules https://github.com/Yunshiro/2048-onchain.git
cd 2048-onchain
```

如果克隆时没有初始化子模块：

```bash
git submodule update --init --recursive
```

### 合约开发

```bash
forge build
forge test -vvv
forge fmt --check
```

运行单个测试：

```bash
forge test --match-test testMoveLeft -vvv
```

### 前端开发

```bash
cd web
pnpm install --frozen-lockfile
cp .env.example .env
pnpm dev
```

默认访问地址为 [http://127.0.0.1:5173](http://127.0.0.1:5173)。

可用的前端环境变量：

| 变量 | 作用 | 默认值 |
| --- | --- | --- |
| `VITE_MONAD_RPC_URL` | Monad 测试网 RPC | `https://testnet-rpc.monad.xyz` |
| `VITE_GAME_CONTRACT_ADDRESS` | 游戏合约地址 | 当前 V2.3 地址 |

生产检查：

```bash
cd web
pnpm test
pnpm build
```

## 会话钱包和 MON

浏览器会为每个登录钱包生成独立的临时会话钱包：

1. 登录钱包授权会话并预存 1–5 MON。
2. 合约先将会话账户补到 0.5 MON，用于支付移动交易。
3. 剩余金额进入登录钱包对应的链上预存池。
4. 每次移动后，合约按实际消耗返还会话 Gas，单步最多 0.1 MON。
5. 会话过期或被撤销后，登录钱包可以取回未使用的预存。

会话私钥只存在当前页面的 JavaScript 内存中，不写入 `localStorage`、`sessionStorage` 或 IndexedDB。刷新页面后需要重新授权。

## 本地部署

复制根目录环境变量：

```bash
cp .env.example .env
```

启动本地节点：

```bash
anvil
```

另开终端执行：

```bash
source .env
forge script script/Deploy.s.sol:Deploy \
  --rpc-url http://127.0.0.1:8545 \
  --broadcast
```

`.env` 必须配置 `SECURITY_ADMIN`。本地开发可以使用 Anvil 账户，公开测试网或主网必须使用多签地址。

## 部署到 Monad 测试网

推荐使用 Foundry 加密 keystore，避免在命令行或项目文件中暴露私钥：

```bash
forge script script/Deploy.s.sol:Deploy \
  --rpc-url https://testnet-rpc.monad.xyz \
  --account monad-deployer \
  --no-proxy \
  --broadcast
```

默认 keystore 路径示例：

```text
~/.foundry/keystores/monad-deployer
```

部署后至少验证：

```bash
cast call <CONTRACT> "securityAdmin()(address)" --rpc-url https://testnet-rpc.monad.xyz
cast call <CONTRACT> "paused()(bool)" --rpc-url https://testnet-rpc.monad.xyz
cast call <CONTRACT> "SESSION_DURATION()(uint256)" --rpc-url https://testnet-rpc.monad.xyz
cast call <CONTRACT> "MAX_SESSION_REFUND()(uint256)" --rpc-url https://testnet-rpc.monad.xyz
cast call <CONTRACT> "SESSION_BOOTSTRAP()(uint256)" --rpc-url https://testnet-rpc.monad.xyz
cast call <CONTRACT> "MAX_REFUND_PER_MOVE()(uint256)" --rpc-url https://testnet-rpc.monad.xyz
```

确认参数无误后，再更新 `web/src/config/chain.ts`、`web/.env.example` 和项目文档。

## 项目结构

```text
.
├── src/Game2048.sol             # 核心游戏与会话合约
├── script/Deploy.s.sol          # Foundry 部署脚本
├── test/                        # Solidity 单元和模糊测试
├── web/                         # React 前端
│   ├── src/components/          # 棋盘、数字块、控制和状态组件
│   ├── src/hooks/useGame.ts     # 链上状态、乐观更新和交易队列
│   ├── src/lib/                 # 游戏引擎、会话与测试
│   └── public/_headers          # CSP 和安全响应头
├── docs/                        # MVP 实施与安全说明
└── .github/workflows/test.yml   # 合约与前端 CI
```

## 安全说明

- `SECURITY_ADMIN` 应使用多签，不应使用日常热钱包。
- 暂停状态下仍允许撤销会话和取回预存资金。
- 前端会验证 V2.3 安全参数，并区分合约不兼容与 RPC 网络故障。
- 自定义 RPC 时需要同步修改 `web/public/_headers` 中 CSP 的 `connect-src`。
- 静态托管平台必须实际返回 `_headers` 中的安全头；仅将文件打包进产物并不会自动生效。
- CI 包含格式检查、合约构建、合约测试、前端测试、依赖审计和生产构建。
- 本项目不代表已经完成独立审计。任何涉及真实价值的公开部署都应先进行第三方审计并建立漏洞响应流程。

## 历史部署

| 版本 | 地址 | 状态 |
| --- | --- | --- |
| V2.2 | [`0x6DbdAC842321491C91fd9bc869AbfFF7316ff1e1`](https://testnet.monadexplorer.com/address/0x6DbdAC842321491C91fd9bc869AbfFF7316ff1e1) | 已废弃：会话垫资不足 |
| V2.1 | [`0x50B58D39e3FD285C1F1Fb52874acA46334e27A4E`](https://testnet.monadexplorer.com/address/0x50B58D39e3FD285C1F1Fb52874acA46334e27A4E) | 已废弃：单会话上限 0.1 MON |
| V2 | [`0x08D370C799c2223D4aC743db0e95d0bd438404A6`](https://testnet.monadexplorer.com/address/0x08D370C799c2223D4aC743db0e95d0bd438404A6) | 已废弃：单会话上限 0.01 MON |
| V1 | [`0xF0beD36a9dF26C546A8df72F27BECa1642d41C78`](https://testnet.monadexplorer.com/address/0xF0beD36a9dF26C546A8df72F27BECa1642d41C78) | 不得用于公开部署 |

更完整的需求、实现决策和上线检查项请阅读 [MVP 实施文档](docs/chain2048-MVP实施文档.md)。
