// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract Game2048 {
    uint256 public constant SESSION_BOOTSTRAP = 0.5 ether;
    uint256 public constant SESSION_DURATION = 1 days;
    uint256 public constant MAX_SESSION_REFUND = 5 ether;
    uint256 public constant MAX_REFUND_PER_MOVE = 0.1 ether;
    uint256 internal constant GAS_REFUND_OVERHEAD = 45_000;

    enum Direction {
        Up,
        Down,
        Left,
        Right
    }

    struct Game {
        address owner;
        uint256 board;
        uint256 score;
        uint32 moveCount;
        bool over;
    }

    uint256 public nextGameId = 1;
    mapping(uint256 => Game) public games;
    mapping(address => address) public sessionToOwner;
    mapping(address => address) public activeSessionOf;
    mapping(address => uint64) public sessionExpiresAt;
    mapping(address => uint256) public sessionRefundRemaining;
    mapping(address => uint256) public activeGameOf;
    mapping(address => uint256) public highScore;
    mapping(address => uint256) public gasBalance;

    address public securityAdmin;
    address public pendingSecurityAdmin;
    bool public paused;
    uint256 private reentrancyStatus = 1;

    event SessionAuthorized(address indexed owner, address indexed sessionKey, uint64 expiresAt, uint256 refundLimit);
    event SessionRevoked(address indexed owner, address indexed sessionKey);
    event GasDeposited(address indexed owner, uint256 amount);
    event GasWithdrawn(address indexed owner, uint256 amount);
    event GasRefunded(address indexed owner, address indexed sessionKey, uint256 amount);
    event GameStarted(uint256 indexed gameId, address indexed owner, uint256 board);
    event Moved(uint256 indexed gameId, Direction dir, uint256 board, uint256 score, uint32 moveCount, bool over);
    event PauseChanged(bool paused);
    event SecurityAdminTransferStarted(address indexed currentAdmin, address indexed pendingAdmin);
    event SecurityAdminTransferred(address indexed previousAdmin, address indexed newAdmin);

    error NotAuthorized();
    error NoActiveGame();
    error GameIsOver();
    error NoMove();
    error InvalidAmount();
    error TransferFailed();
    error SessionExpired();
    error ContractPaused();
    error NotSecurityAdmin();

    modifier whenNotPaused() {
        if (paused) revert ContractPaused();
        _;
    }

    modifier onlySecurityAdmin() {
        if (msg.sender != securityAdmin) revert NotSecurityAdmin();
        _;
    }

    modifier nonReentrant() {
        if (reentrancyStatus != 1) revert TransferFailed();
        reentrancyStatus = 2;
        _;
        reentrancyStatus = 1;
    }

    constructor(address initialSecurityAdmin) {
        if (initialSecurityAdmin == address(0)) revert NotSecurityAdmin();
        securityAdmin = initialSecurityAdmin;
        emit SecurityAdminTransferred(address(0), initialSecurityAdmin);
    }

    /// @notice Authorizes a session and optionally funds its gas pipeline.
    /// @dev Up to SESSION_BOOTSTRAP is sent to the session for its first tx;
    ///      the remainder is credited to the owner's reimbursement balance.
    function authorizeSession(address sessionKey) external payable whenNotPaused nonReentrant {
        if (sessionKey == address(0) || sessionKey == msg.sender) revert NotAuthorized();

        address previousOwner = sessionToOwner[sessionKey];
        if (previousOwner != address(0)) _revokeSession(previousOwner, sessionKey);
        address oldSession = activeSessionOf[msg.sender];
        if (oldSession != address(0)) _revokeSession(msg.sender, oldSession);

        sessionToOwner[sessionKey] = msg.sender;
        activeSessionOf[msg.sender] = sessionKey;
        // Safe until well beyond the lifetime of the EVM; the checked addition
        // would revert before this cast could truncate in any realistic epoch.
        // forge-lint: disable-next-line(unsafe-typecast)
        uint64 expiresAt = uint64(block.timestamp + SESSION_DURATION);
        sessionExpiresAt[sessionKey] = expiresAt;

        if (msg.value != 0) _fundSession(msg.sender, sessionKey, msg.value);
        uint256 allowance = gasBalance[msg.sender];
        if (allowance > MAX_SESSION_REFUND) allowance = MAX_SESSION_REFUND;
        sessionRefundRemaining[sessionKey] = allowance;
        emit SessionAuthorized(msg.sender, sessionKey, expiresAt, allowance);
    }

    /// @notice Tops up an authorized session and its owner's reimbursement pool.
    function fundSession(address sessionKey) external payable whenNotPaused nonReentrant {
        if (!_isActiveSession(msg.sender, sessionKey)) revert NotAuthorized();
        // Validator timestamp drift is negligible relative to a 24-hour session.
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp >= sessionExpiresAt[sessionKey]) revert SessionExpired();
        if (msg.value == 0) revert InvalidAmount();
        uint256 deposited = _fundSession(msg.sender, sessionKey, msg.value);
        uint256 allowance = sessionRefundRemaining[sessionKey] + deposited;
        if (allowance > MAX_SESSION_REFUND) allowance = MAX_SESSION_REFUND;
        if (allowance > gasBalance[msg.sender]) allowance = gasBalance[msg.sender];
        sessionRefundRemaining[sessionKey] = allowance;
    }

    /// @notice Adds MON that will reimburse authorized session transactions.
    function depositGas() external payable whenNotPaused {
        if (msg.value == 0) revert InvalidAmount();
        gasBalance[msg.sender] += msg.value;
        emit GasDeposited(msg.sender, msg.value);
    }

    /// @notice Returns unused sponsored-gas funds to the logged-in owner.
    function withdrawGas(uint256 amount) external nonReentrant {
        if (amount == 0 || amount > gasBalance[msg.sender]) revert InvalidAmount();
        gasBalance[msg.sender] -= amount;
        (bool sent,) = payable(msg.sender).call{value: amount}("");
        if (!sent) revert TransferFailed();
        emit GasWithdrawn(msg.sender, amount);
    }

    /// @notice Opening/restarting a game is deliberately owner-only.
    function startGame() external whenNotPaused returns (uint256 gameId) {
        address owner = msg.sender;

        uint256 oldGameId = activeGameOf[owner];
        if (oldGameId != 0) games[oldGameId].over = true;

        gameId = nextGameId++;
        uint256 board;
        board = _spawnTile(board, _random(gameId, 0, board));
        board = _spawnTile(board, _random(gameId, 0, board));

        games[gameId] = Game({owner: owner, board: board, score: 0, moveCount: 0, over: false});
        activeGameOf[owner] = gameId;

        emit GameStarted(gameId, owner, board);
    }

    function move(uint256 gameId, Direction dir) external whenNotPaused nonReentrant {
        uint256 gasStart = gasleft();
        address owner = _authorizedSessionOwner(msg.sender);

        Game storage game = games[gameId];
        if (game.owner == address(0)) revert NoActiveGame();
        if (game.owner != owner) revert NotAuthorized();
        if (game.over) revert GameIsOver();

        (uint256 newBoard, uint256 gained) = applyMove(game.board, dir);
        if (newBoard == game.board) revert NoMove();

        newBoard = _spawnTile(newBoard, _random(gameId, game.moveCount, newBoard));
        game.board = newBoard;
        game.score += gained;
        game.moveCount += 1;

        if (game.score > highScore[owner]) highScore[owner] = game.score;

        if (isGameOver(newBoard)) {
            game.over = true;
            activeGameOf[owner] = 0;
        }

        emit Moved(gameId, dir, newBoard, game.score, game.moveCount, game.over);
        _refundGas(owner, gasStart);
    }

    function revokeSession() external {
        address sessionKey = activeSessionOf[msg.sender];
        if (sessionKey == address(0)) revert NotAuthorized();
        _revokeSession(msg.sender, sessionKey);
    }

    function setPaused(bool newPaused) external onlySecurityAdmin {
        paused = newPaused;
        emit PauseChanged(newPaused);
    }

    function beginSecurityAdminTransfer(address newAdmin) external onlySecurityAdmin {
        if (newAdmin == address(0)) revert NotSecurityAdmin();
        pendingSecurityAdmin = newAdmin;
        emit SecurityAdminTransferStarted(msg.sender, newAdmin);
    }

    function acceptSecurityAdmin() external {
        if (msg.sender != pendingSecurityAdmin) revert NotSecurityAdmin();
        address previousAdmin = securityAdmin;
        securityAdmin = msg.sender;
        pendingSecurityAdmin = address(0);
        emit SecurityAdminTransferred(previousAdmin, msg.sender);
    }

    function getBoard(uint256 gameId) external view returns (uint8[16] memory cells, uint256 score, bool over) {
        Game storage game = games[gameId];
        if (game.owner == address(0)) revert NoActiveGame();

        for (uint256 i; i < 16; ++i) {
            cells[i] = getCell(game.board, i);
        }
        return (cells, game.score, game.over);
    }

    function getCell(uint256 board, uint256 i) internal pure returns (uint8) {
        return uint8((board >> (i * 4)) & 0xF);
    }

    function setCell(uint256 board, uint256 i, uint8 value) internal pure returns (uint256) {
        uint256 shift = i * 4;
        uint256 mask = uint256(0xF) << shift;
        return (board & ~mask) | (uint256(value & 0xF) << shift);
    }

    function countEmpty(uint256 board) internal pure returns (uint256 count) {
        for (uint256 i; i < 16; ++i) {
            if (getCell(board, i) == 0) ++count;
        }
    }

    function slideRowLeft(uint8[4] memory row) internal pure returns (uint8[4] memory result, uint256 gained) {
        uint8[4] memory compact;
        uint256 length;
        for (uint256 i; i < 4; ++i) {
            if (row[i] != 0) compact[length++] = row[i];
        }

        uint256 outputIndex;
        uint256 inputIndex;
        while (inputIndex < length) {
            uint8 value = compact[inputIndex];
            if (inputIndex + 1 < length && value == compact[inputIndex + 1] && value < 15) {
                value += 1;
                gained += uint256(1) << value;
                inputIndex += 2;
            } else {
                inputIndex += 1;
            }
            result[outputIndex++] = value;
        }
    }

    function applyMove(uint256 board, Direction dir) internal pure returns (uint256 newBoard, uint256 gained) {
        for (uint256 line; line < 4; ++line) {
            uint8[4] memory row;
            for (uint256 offset; offset < 4; ++offset) {
                row[offset] = getCell(board, _cellIndex(dir, line, offset));
            }

            uint256 rowGained;
            (row, rowGained) = slideRowLeft(row);
            gained += rowGained;

            for (uint256 offset; offset < 4; ++offset) {
                newBoard = setCell(newBoard, _cellIndex(dir, line, offset), row[offset]);
            }
        }
    }

    function isGameOver(uint256 board) internal pure returns (bool) {
        if (countEmpty(board) != 0) return false;

        for (uint256 row; row < 4; ++row) {
            for (uint256 col; col < 4; ++col) {
                uint8 value = getCell(board, row * 4 + col);
                if (col < 3 && value == getCell(board, row * 4 + col + 1)) return false;
                if (row < 3 && value == getCell(board, (row + 1) * 4 + col)) return false;
            }
        }
        return true;
    }

    function _cellIndex(Direction dir, uint256 line, uint256 offset) private pure returns (uint256) {
        if (dir == Direction.Left) return line * 4 + offset;
        if (dir == Direction.Right) return line * 4 + (3 - offset);
        if (dir == Direction.Up) return offset * 4 + line;
        return (3 - offset) * 4 + line;
    }

    function _spawnTile(uint256 board, uint256 random) internal pure returns (uint256) {
        uint256 empty = countEmpty(board);
        if (empty == 0) return board;

        uint256 target = random % empty;
        uint8 value = random % 10 == 0 ? 2 : 1;
        for (uint256 i; i < 16; ++i) {
            if (getCell(board, i) != 0) continue;
            if (target == 0) return setCell(board, i, value);
            --target;
        }
        return board;
    }

    function _random(uint256 gameId, uint32 moveCount, uint256 board) internal pure returns (uint256) {
        return uint256(keccak256(abi.encode(gameId, moveCount, board)));
    }

    function _refundGas(address owner, uint256 gasStart) private {
        uint256 available = gasBalance[owner];
        if (available == 0 || tx.gasprice == 0) return;

        uint256 refund = (gasStart - gasleft() + GAS_REFUND_OVERHEAD) * tx.gasprice;
        if (refund > MAX_REFUND_PER_MOVE) refund = MAX_REFUND_PER_MOVE;
        uint256 remaining = sessionRefundRemaining[msg.sender];
        if (refund > remaining) refund = remaining;
        if (refund > available) refund = available;
        if (refund == 0) return;
        gasBalance[owner] = available - refund;
        sessionRefundRemaining[msg.sender] = remaining - refund;

        // Session keys are EOAs in this MVP. The stipend prevents a contract
        // session from re-entering game state during reimbursement.
        (bool sent,) = payable(msg.sender).call{value: refund, gas: 2_300}("");
        if (!sent) {
            gasBalance[owner] = available;
            sessionRefundRemaining[msg.sender] = remaining;
            return;
        }
        emit GasRefunded(owner, msg.sender, refund);
    }

    function _fundSession(address owner, address sessionKey, uint256 amount) private returns (uint256 deposit) {
        uint256 needed = sessionKey.balance < SESSION_BOOTSTRAP ? SESSION_BOOTSTRAP - sessionKey.balance : 0;
        uint256 bootstrap = amount < needed ? amount : needed;
        deposit = amount - bootstrap;
        if (deposit != 0) {
            gasBalance[owner] += deposit;
            emit GasDeposited(owner, deposit);
        }
        if (bootstrap != 0) {
            (bool sent,) = payable(sessionKey).call{value: bootstrap, gas: 2_300}("");
            if (!sent) revert TransferFailed();
        }
    }

    function _authorizedSessionOwner(address sessionKey) private view returns (address owner) {
        owner = sessionToOwner[sessionKey];
        if (owner == address(0) || !_isActiveSession(owner, sessionKey)) revert NotAuthorized();
        // Validator timestamp drift is negligible relative to a 24-hour session.
        // forge-lint: disable-next-line(block-timestamp)
        if (block.timestamp >= sessionExpiresAt[sessionKey]) revert SessionExpired();
    }

    function _isActiveSession(address owner, address sessionKey) private view returns (bool) {
        return activeSessionOf[owner] == sessionKey && sessionToOwner[sessionKey] == owner;
    }

    function _revokeSession(address owner, address sessionKey) private {
        if (activeSessionOf[owner] == sessionKey) delete activeSessionOf[owner];
        if (sessionToOwner[sessionKey] == owner) delete sessionToOwner[sessionKey];
        delete sessionExpiresAt[sessionKey];
        delete sessionRefundRemaining[sessionKey];
        emit SessionRevoked(owner, sessionKey);
    }
}
