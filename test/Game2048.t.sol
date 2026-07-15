// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Game2048} from "../src/Game2048.sol";
import {Game2048Harness} from "./Board.t.sol";

contract Game2048Test is Test {
    Game2048Harness internal game;
    address internal owner = makeAddr("owner");
    address internal session = makeAddr("session");

    function setUp() public {
        game = new Game2048Harness();
        vm.prank(owner);
        game.authorizeSession(session);
    }

    function test_AuthorizeSessionAndOverwriteOwner() public {
        assertEq(game.sessionToOwner(session), owner);

        address anotherOwner = makeAddr("anotherOwner");
        vm.prank(anotherOwner);
        game.authorizeSession(session);
        assertEq(game.sessionToOwner(session), anotherOwner);
        assertEq(game.activeSessionOf(owner), address(0));
        assertEq(game.activeSessionOf(anotherOwner), session);
    }

    function test_AuthorizeZeroAddressReverts() public {
        vm.prank(owner);
        vm.expectRevert(Game2048.NotAuthorized.selector);
        game.authorizeSession(address(0));
    }

    function test_AuthorizeWithValueBootstrapsSessionAndCreditsOwner() public {
        address fundedOwner = makeAddr("fundedOwner");
        address fundedSession = makeAddr("fundedSession");
        vm.deal(fundedOwner, 10 ether);

        vm.prank(fundedOwner);
        game.authorizeSession{value: 6 ether}(fundedSession);

        assertEq(game.sessionToOwner(fundedSession), fundedOwner);
        assertEq(fundedSession.balance, game.SESSION_BOOTSTRAP());
        assertEq(game.gasBalance(fundedOwner), 5.5 ether);
        assertEq(game.sessionRefundRemaining(fundedSession), game.MAX_SESSION_REFUND());
        assertEq(address(game).balance, 5.5 ether);
    }

    function test_DepositAndWithdrawUnusedGas() public {
        vm.deal(owner, 1 ether);
        vm.prank(owner);
        game.depositGas{value: 0.1 ether}();

        assertEq(game.gasBalance(owner), 0.1 ether);
        assertEq(address(game).balance, 0.1 ether);

        vm.prank(owner);
        game.withdrawGas(0.04 ether);
        assertEq(game.gasBalance(owner), 0.06 ether);
        assertEq(address(game).balance, 0.06 ether);
        assertEq(owner.balance, 0.94 ether);
    }

    function test_FundSessionDoesNotOverfundBootstrap() public {
        vm.deal(owner, 10 ether);
        vm.deal(session, 0.6 ether);

        vm.prank(owner);
        game.fundSession{value: 6 ether}(session);

        assertEq(session.balance, 0.6 ether);
        assertEq(game.gasBalance(owner), 6 ether);
        assertEq(game.sessionRefundRemaining(session), game.MAX_SESSION_REFUND());
        assertEq(address(game).balance, 6 ether);
    }

    function test_FundSessionRejectsUnauthorizedOwner() public {
        address stranger = makeAddr("stranger");
        vm.deal(stranger, 1 ether);
        vm.prank(stranger);
        vm.expectRevert(Game2048.NotAuthorized.selector);
        game.fundSession{value: 0.05 ether}(session);
    }

    function test_InvalidGasDepositAndWithdrawRevert() public {
        vm.expectRevert(Game2048.InvalidAmount.selector);
        game.depositGas();

        vm.prank(owner);
        vm.expectRevert(Game2048.InvalidAmount.selector);
        game.withdrawGas(1);
    }

    function test_UnauthorizedMoveReverts() public {
        vm.prank(owner);
        uint256 gameId = game.startGame();
        vm.expectRevert(Game2048.NotAuthorized.selector);
        game.move(gameId, Game2048.Direction.Left);
    }

    function test_SessionCanBeRevokedImmediately() public {
        vm.prank(owner);
        game.revokeSession();
        assertEq(game.activeSessionOf(owner), address(0));
        assertEq(game.sessionToOwner(session), address(0));
        assertEq(game.sessionRefundRemaining(session), 0);

        game.seedGame(77, owner, 17, 0, false);
        vm.prank(session);
        vm.expectRevert(Game2048.NotAuthorized.selector);
        game.move(77, Game2048.Direction.Left);
    }

    function test_SessionExpiresAfterOneDay() public {
        game.seedGame(77, owner, 17, 0, false);
        vm.warp(game.sessionExpiresAt(session));
        vm.prank(session);
        vm.expectRevert(Game2048.SessionExpired.selector);
        game.move(77, Game2048.Direction.Left);
    }

    function test_NewSessionRevokesPreviousSession() public {
        address replacement = makeAddr("replacement");
        vm.prank(owner);
        game.authorizeSession(replacement);
        assertEq(game.activeSessionOf(owner), replacement);
        assertEq(game.sessionToOwner(session), address(0));
        assertEq(game.sessionToOwner(replacement), owner);
    }

    function test_StartGameSpawnsExactlyTwoTiles() public {
        vm.prank(owner);
        uint256 gameId = game.startGame();

        (uint8[16] memory cells, uint256 score, bool over) = game.getBoard(gameId);
        uint256 nonEmpty;
        for (uint256 i; i < 16; ++i) {
            if (cells[i] == 0) continue;
            ++nonEmpty;
            assertTrue(cells[i] == 1 || cells[i] == 2);
        }
        assertEq(nonEmpty, 2);
        assertEq(score, 0);
        assertFalse(over);
        assertEq(game.activeGameOf(owner), gameId);
    }

    function test_StartingAgainAbandonsPreviousGame() public {
        vm.startPrank(owner);
        uint256 firstId = game.startGame();
        uint256 secondId = game.startGame();
        vm.stopPrank();

        (,,,, bool firstOver) = game.games(firstId);
        (address secondOwner,,,, bool secondOver) = game.games(secondId);
        assertTrue(firstOver);
        assertEq(secondOwner, owner);
        assertFalse(secondOver);
        assertEq(game.activeGameOf(owner), secondId);
    }

    function testFuzz_SpawnOnlyChangesOneEmptyCell(uint256 board, uint256 random, uint8 clearedIndex) public view {
        clearedIndex = uint8(bound(clearedIndex, 0, 15));
        board = game.exposedSetCell(board, clearedIndex, 0);
        uint256 spawned = game.exposedSpawnTile(board, random);

        uint256 changes;
        for (uint256 i; i < 16; ++i) {
            uint8 beforeValue = game.exposedGetCell(board, i);
            uint8 afterValue = game.exposedGetCell(spawned, i);
            if (beforeValue == afterValue) continue;
            ++changes;
            assertEq(beforeValue, 0);
            assertTrue(afterValue == 1 || afterValue == 2);
        }
        assertEq(changes, 1);
        assertEq(game.exposedCountEmpty(spawned) + 1, game.exposedCountEmpty(board));
    }

    function test_DeterministicRandomMatchesDocumentedEncoding() public view {
        uint256 expected = uint256(keccak256(abi.encode(uint256(77), uint32(3), uint256(0x1234))));
        assertEq(game.exposedRandom(77, 3, 0x1234), expected);
    }

    function test_MoveUpdatesScoreHighScoreAndCount() public {
        uint256 board = _board([1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
        game.seedGame(77, owner, board, 0, false);

        vm.prank(session);
        game.move(77, Game2048.Direction.Left);

        (, uint256 newBoard, uint256 score, uint32 moveCount, bool over) = game.games(77);
        assertEq(score, 4);
        assertEq(moveCount, 1);
        assertFalse(over);
        assertEq(game.highScore(owner), 4);
        assertEq(game.exposedCountEmpty(newBoard), 14);
    }

    function test_MoveRefundsSessionFromOwnerGasBalance() public {
        uint256 board = _board([1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
        game.seedGame(77, owner, board, 0, false);
        vm.deal(owner, 1 ether);
        vm.prank(owner);
        game.fundSession{value: 1 ether}(session);

        uint256 poolBefore = game.gasBalance(owner);
        uint256 sessionBefore = session.balance;
        vm.txGasPrice(1 gwei);
        vm.prank(session);
        game.move(77, Game2048.Direction.Left);

        uint256 reimbursed = session.balance - sessionBefore;
        assertGt(reimbursed, 0);
        assertEq(poolBefore - game.gasBalance(owner), reimbursed);
        assertEq(address(game).balance, game.gasBalance(owner));
    }

    function test_ReimbursementIsCappedByOwnerGasBalance() public {
        uint256 board = _board([1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
        game.seedGame(77, owner, board, 0, false);
        vm.deal(session, game.SESSION_BOOTSTRAP());
        vm.deal(owner, 1);
        vm.prank(owner);
        game.fundSession{value: 1}(session);

        uint256 sessionBefore = session.balance;
        vm.txGasPrice(1 gwei);
        vm.prank(session);
        game.move(77, Game2048.Direction.Left);

        assertEq(game.gasBalance(owner), 0);
        assertEq(session.balance - sessionBefore, 1);
    }

    function test_RefundIsCappedPerMoveAndPerSession() public {
        vm.deal(session, game.SESSION_BOOTSTRAP());
        vm.deal(owner, 10 ether);
        vm.prank(owner);
        game.fundSession{value: 6 ether}(session);
        uint256 poolBefore = game.gasBalance(owner);
        assertEq(game.sessionRefundRemaining(session), game.MAX_SESSION_REFUND());

        vm.txGasPrice(10_000 gwei);
        game.seedGame(77, owner, 17, 0, false);
        uint256 balanceBefore = session.balance;
        vm.prank(session);
        game.move(77, Game2048.Direction.Left);
        assertEq(session.balance - balanceBefore, game.MAX_REFUND_PER_MOVE());
        assertEq(game.sessionRefundRemaining(session), game.MAX_SESSION_REFUND() - game.MAX_REFUND_PER_MOVE());

        game.seedSessionRefundRemaining(session, game.MAX_REFUND_PER_MOVE());
        game.seedGame(77, owner, 17, 0, false);
        balanceBefore = session.balance;
        vm.prank(session);
        game.move(77, Game2048.Direction.Left);

        assertEq(game.sessionRefundRemaining(session), 0);
        assertEq(session.balance - balanceBefore, game.MAX_REFUND_PER_MOVE());
        assertEq(poolBefore - game.gasBalance(owner), 2 * game.MAX_REFUND_PER_MOVE());
    }

    function test_NoMoveReverts() public {
        uint256 board = _board([1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
        game.seedGame(77, owner, board, 0, false);

        vm.prank(session);
        vm.expectRevert(Game2048.NoMove.selector);
        game.move(77, Game2048.Direction.Left);
    }

    function test_RevertedMoveDoesNotConsumeOwnerGasBalance() public {
        uint256 board = _board([1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
        game.seedGame(77, owner, board, 0, false);
        vm.deal(owner, 1 ether);
        vm.prank(owner);
        game.fundSession{value: 1 ether}(session);
        uint256 poolBefore = game.gasBalance(owner);

        vm.txGasPrice(1 gwei);
        vm.prank(session);
        vm.expectRevert(Game2048.NoMove.selector);
        game.move(77, Game2048.Direction.Left);
        assertEq(game.gasBalance(owner), poolBefore);
    }

    function test_MoveChecksMissingWrongOwnerAndOverGames() public {
        vm.prank(session);
        vm.expectRevert(Game2048.NoActiveGame.selector);
        game.move(99, Game2048.Direction.Left);

        address otherOwner = makeAddr("otherOwner");
        game.seedGame(1, otherOwner, 1, 0, false);
        vm.prank(session);
        vm.expectRevert(Game2048.NotAuthorized.selector);
        game.move(1, Game2048.Direction.Right);

        game.seedGame(2, owner, 1, 0, true);
        vm.prank(session);
        vm.expectRevert(Game2048.GameIsOver.selector);
        game.move(2, Game2048.Direction.Right);
    }

    function test_GameOverDetection() public view {
        uint256 terminal = _board([1, 2, 1, 2, 2, 1, 2, 1, 1, 2, 1, 2, 2, 1, 2, 1]);
        uint256 mergeAvailable = _board([1, 1, 2, 1, 2, 1, 2, 1, 1, 2, 1, 2, 2, 1, 2, 1]);
        uint256 hasEmpty = game.exposedSetCell(terminal, 15, 0);

        assertTrue(game.exposedIsGameOver(terminal));
        assertFalse(game.exposedIsGameOver(mergeAvailable));
        assertFalse(game.exposedIsGameOver(hasEmpty));
    }

    function test_PauseBlocksGameActionsButNotRevocationOrWithdrawal() public {
        vm.deal(owner, 0.1 ether);
        vm.prank(owner);
        game.depositGas{value: 0.1 ether}();
        game.setPaused(true);

        vm.prank(owner);
        vm.expectRevert(Game2048.ContractPaused.selector);
        game.startGame();

        vm.prank(owner);
        game.revokeSession();
        assertEq(game.activeSessionOf(owner), address(0));

        vm.prank(owner);
        game.withdrawGas(0.1 ether);
        assertEq(game.gasBalance(owner), 0);
    }

    function test_SecurityAdminTransferRequiresAcceptance() public {
        address newAdmin = makeAddr("newAdmin");
        game.beginSecurityAdminTransfer(newAdmin);
        assertEq(game.pendingSecurityAdmin(), newAdmin);

        vm.prank(newAdmin);
        game.acceptSecurityAdmin();
        assertEq(game.securityAdmin(), newAdmin);
        assertEq(game.pendingSecurityAdmin(), address(0));

        vm.expectRevert(Game2048.NotSecurityAdmin.selector);
        game.setPaused(true);
        vm.prank(newAdmin);
        game.setPaused(true);
        assertTrue(game.paused());
    }

    function test_CompleteAuthorizedGameFlowReachesGameOver() public {
        vm.prank(owner);
        uint256 gameId = game.startGame();

        for (uint256 turn; turn < 2000; ++turn) {
            (, uint256 board, uint256 score,, bool over) = game.games(gameId);
            if (over) {
                assertEq(game.activeGameOf(owner), 0);
                assertEq(game.highScore(owner), score);
                assertGt(score, 0);
                return;
            }

            bool moved;
            uint256 firstDirection = uint256(keccak256(abi.encode(turn, board))) % 4;
            for (uint256 offset; offset < 4; ++offset) {
                Game2048.Direction direction = Game2048.Direction((firstDirection + offset) % 4);
                (uint256 preview,) = game.exposedApplyMove(board, direction);
                if (preview == board) continue;

                vm.prank(session);
                game.move(gameId, direction);
                moved = true;
                break;
            }
            assertTrue(moved, "non-over board had no legal move");
        }
        fail("game did not finish within move limit");
    }

    function _board(uint8[16] memory cells) private pure returns (uint256 board) {
        for (uint256 i; i < 16; ++i) {
            board |= uint256(cells[i]) << (i * 4);
        }
    }
}
