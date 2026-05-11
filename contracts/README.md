# contracts

Solidity ERC-20 + mint oracle. Targets Sepolia.

## Install & compile

```bash
npm install
npx hardhat compile
npx hardhat test
```

## Deploy to Sepolia

Fill `../.env` (see `../.env.example`), then:

```bash
npm run deploy:sepolia
```

## Roles

- `DEFAULT_ADMIN_ROLE` — rotates keys, changes `MINTER_ROLE`.
- `MINTER_ROLE` — held by the Relay Node hot key. Can call `mintReward`.

## Replay protection

Every accepted proof is keyed by `keccak256(seed, miner)` in `usedProofs`.
This binds the reward destination to the seed, so a leaked proof cannot be
redirected to a different address.

## Future: on-chain VDF verification

When the VDF moves from a pragmatic hash chain to Wesolowski, `mintReward`
will take the full proof bundle and MINTER_ROLE will be revoked from hot keys.
