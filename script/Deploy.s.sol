// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script} from "forge-std/Script.sol";
import {Game2048} from "../src/Game2048.sol";

contract Deploy is Script {
    function run() external returns (Game2048 game) {
        uint256 deployerPrivateKey = vm.envOr("PRIVATE_KEY", uint256(0));
        address securityAdmin = vm.envOr("SECURITY_ADMIN", address(0));
        require(securityAdmin != address(0), "SECURITY_ADMIN is required");
        if (deployerPrivateKey == 0) {
            vm.startBroadcast();
        } else {
            vm.startBroadcast(deployerPrivateKey);
        }
        game = new Game2048(securityAdmin);
        vm.stopBroadcast();
    }
}
