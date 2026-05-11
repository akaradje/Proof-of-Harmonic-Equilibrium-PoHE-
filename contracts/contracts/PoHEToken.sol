// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @title  PoHEToken
 * @notice ERC-20 minted by the Relay Node after a VDF proof is verified.
 *
 * @dev    The Relay holds MINTER_ROLE. The contract stores a commitment
 *         `keccak256(seed || miner)` per accepted proof to prevent replays —
 *         a relay key leak is still catastrophic, but at least a single
 *         captured proof cannot be redeemed twice.
 *
 *         Trust model: MVP. The relay is a trusted oracle. Future versions
 *         can replace this with on-chain VDF verification (Wesolowski) and
 *         strip MINTER_ROLE from any hot key.
 */
contract PoHEToken is ERC20, AccessControl {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    /// @dev keccak256(seed, miner) => used. Prevents replay of an accepted proof.
    mapping(bytes32 => bool) public usedProofs;

    /// @dev Cap on a single mint call to limit blast radius of a compromised relay.
    uint256 public immutable maxMintPerBlock;

    event ProofAccepted(
        address indexed miner,
        bytes32 indexed seed,
        uint256 amount,
        bytes32 proofId
    );

    error ProofAlreadyUsed(bytes32 proofId);
    error MintAmountExceedsCap(uint256 requested, uint256 cap);

    constructor(
        string memory name_,
        string memory symbol_,
        address admin,
        address relay,
        uint256 maxMintPerBlock_
    ) ERC20(name_, symbol_) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(MINTER_ROLE, relay);
        maxMintPerBlock = maxMintPerBlock_;
    }

    /**
     * @notice Mint reward for a verified VDF proof.
     * @param  miner  Address to credit.
     * @param  amount Reward amount (wei units of the token).
     * @param  seed   The block seed that the miner solved.
     *
     * @dev The proof payload itself is verified off-chain by the relay before
     *      calling this function. This contract only enforces uniqueness and
     *      per-call caps. When VDF verification moves on-chain, this signature
     *      will change to accept the full proof bundle.
     */
    function mintReward(
        address miner,
        uint256 amount,
        bytes32 seed
    ) external onlyRole(MINTER_ROLE) {
        if (amount > maxMintPerBlock) {
            revert MintAmountExceedsCap(amount, maxMintPerBlock);
        }
        bytes32 proofId = keccak256(abi.encodePacked(seed, miner));
        if (usedProofs[proofId]) revert ProofAlreadyUsed(proofId);
        usedProofs[proofId] = true;

        _mint(miner, amount);
        emit ProofAccepted(miner, seed, amount, proofId);
    }
}
