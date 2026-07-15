// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Game2048} from "../src/Game2048.sol";

contract Game2048Harness is Game2048 {
    constructor() Game2048(msg.sender) {}

    function exposedGetCell(uint256 board, uint256 index) external pure returns (uint8) {
        return getCell(board, index);
    }

    function exposedSetCell(uint256 board, uint256 index, uint8 value) external pure returns (uint256) {
        return setCell(board, index, value);
    }

    function exposedCountEmpty(uint256 board) external pure returns (uint256) {
        return countEmpty(board);
    }

    function exposedSlideRowLeft(uint8[4] memory row) external pure returns (uint8[4] memory result, uint256 gained) {
        return slideRowLeft(row);
    }

    function exposedApplyMove(uint256 board, Direction dir) external pure returns (uint256 newBoard, uint256 gained) {
        return applyMove(board, dir);
    }

    function exposedIsGameOver(uint256 board) external pure returns (bool) {
        return isGameOver(board);
    }

    function exposedSpawnTile(uint256 board, uint256 random) external pure returns (uint256) {
        return _spawnTile(board, random);
    }

    function exposedRandom(uint256 gameId, uint32 moveCount, uint256 board) external pure returns (uint256) {
        return _random(gameId, moveCount, board);
    }

    function seedGame(uint256 gameId, address owner, uint256 board, uint256 score, bool over) external {
        games[gameId] = Game({owner: owner, board: board, score: score, moveCount: 0, over: over});
        if (!over) activeGameOf[owner] = gameId;
    }

    function seedSessionRefundRemaining(address sessionKey, uint256 amount) external {
        sessionRefundRemaining[sessionKey] = amount;
    }
}

contract BoardTest is Test {
    Game2048Harness internal game;

    function setUp() public {
        game = new Game2048Harness();
    }

    function test_SetAndGetAllCellsIncludingBoundaries() public view {
        uint256 board;
        for (uint256 i; i < 16; ++i) {
            // Safe because the loop bounds i to the uint8 range 0..15.
            // forge-lint: disable-next-line(unsafe-typecast)
            uint8 value = uint8(i);
            board = game.exposedSetCell(board, i, value);
        }
        for (uint256 i; i < 16; ++i) {
            assertEq(game.exposedGetCell(board, i), i);
        }

        board = game.exposedSetCell(board, 0, 15);
        board = game.exposedSetCell(board, 15, 0);
        assertEq(game.exposedGetCell(board, 0), 15);
        assertEq(game.exposedGetCell(board, 15), 0);
        assertEq(game.exposedCountEmpty(board), 1);
    }

    function test_SlideRowTableCases() public view {
        _assertSlide([1, 1, 1, 1], [2, 2, 0, 0], 8);
        _assertSlide([1, 1, 2, 0], [2, 2, 0, 0], 4);
        _assertSlide([2, 1, 1, 0], [2, 2, 0, 0], 4);
        _assertSlide([1, 0, 0, 1], [2, 0, 0, 0], 4);
        _assertSlide([1, 2, 1, 2], [1, 2, 1, 2], 0);
        _assertSlide([15, 15, 0, 0], [15, 15, 0, 0], 0);
    }

    function testFuzz_SlidePreservesValueAndCompacts(uint16 packed) public view {
        uint8[4] memory row;
        uint256 valueBefore;
        for (uint256 i; i < 4; ++i) {
            row[i] = uint8((packed >> (i * 4)) & 0xF);
            if (row[i] != 0) valueBefore += uint256(1) << row[i];
        }

        (uint8[4] memory result,) = game.exposedSlideRowLeft(row);
        uint256 valueAfter;
        bool sawZero;
        for (uint256 i; i < 4; ++i) {
            if (result[i] == 0) {
                sawZero = true;
            } else {
                assertFalse(sawZero, "non-zero tile after zero");
                valueAfter += uint256(1) << result[i];
            }
        }
        assertEq(valueAfter, valueBefore);
    }

    function test_ApplyMoveInAllDirections() public view {
        uint256 horizontal = _board([1, 0, 1, 0, 2, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
        (uint256 left, uint256 leftScore) = game.exposedApplyMove(horizontal, Game2048.Direction.Left);
        assertEq(left, _board([2, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]));
        assertEq(leftScore, 12);

        (uint256 right, uint256 rightScore) = game.exposedApplyMove(horizontal, Game2048.Direction.Right);
        assertEq(right, _board([0, 0, 0, 2, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 0, 0]));
        assertEq(rightScore, 12);

        uint256 vertical = _board([1, 2, 0, 0, 0, 2, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0]);
        (uint256 up, uint256 upScore) = game.exposedApplyMove(vertical, Game2048.Direction.Up);
        assertEq(up, _board([2, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]));
        assertEq(upScore, 12);

        (uint256 down, uint256 downScore) = game.exposedApplyMove(vertical, Game2048.Direction.Down);
        assertEq(down, _board([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 3, 0, 0]));
        assertEq(downScore, 12);
    }

    function testFuzz_LeftRightHorizontalSymmetry(uint64 packed) public view {
        uint256 board = uint256(packed);
        (uint256 left,) = game.exposedApplyMove(board, Game2048.Direction.Left);
        uint256 flipped = _flipHorizontal(board);
        (uint256 movedRight,) = game.exposedApplyMove(flipped, Game2048.Direction.Right);
        assertEq(left, _flipHorizontal(movedRight));
    }

    function _assertSlide(uint8[4] memory input, uint8[4] memory expected, uint256 expectedScore) private view {
        (uint8[4] memory actual, uint256 score) = game.exposedSlideRowLeft(input);
        for (uint256 i; i < 4; ++i) {
            assertEq(actual[i], expected[i]);
        }
        assertEq(score, expectedScore);
    }

    function _board(uint8[16] memory cells) internal pure returns (uint256 board) {
        for (uint256 i; i < 16; ++i) {
            board |= uint256(cells[i]) << (i * 4);
        }
    }

    function _flipHorizontal(uint256 board) private pure returns (uint256 flipped) {
        for (uint256 row; row < 4; ++row) {
            for (uint256 col; col < 4; ++col) {
                uint256 value = (board >> ((row * 4 + col) * 4)) & 0xF;
                flipped |= value << ((row * 4 + 3 - col) * 4);
            }
        }
    }
}
