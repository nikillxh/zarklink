// Relay System - Zcash Block Header Relay for Starknet
// Stores and verifies Zcash block headers, extracts Sapling commitment tree roots

use starknet::ContractAddress;
use zclaim::relay::types::{BlockHeader, MerkleProof};

#[starknet::interface]
pub trait IRelaySystem<TContractState> {
    /// Submit a new Zcash block header
    fn submit_block_header(
        ref self: TContractState,
        header_data: Array<felt252>,
        height: u64
    ) -> u256;

    /// Submit multiple headers at once (for syncing)
    fn submit_block_headers_batch(
        ref self: TContractState,
        headers: Array<Array<felt252>>,
        start_height: u64
    );

    /// Check if a block has enough confirmations
    fn is_confirmed(self: @TContractState, block_hash: u256) -> bool;

    /// Get the Sapling root for a confirmed block
    fn get_sapling_root(self: @TContractState, block_hash: u256) -> u256;

    /// Verify a note commitment exists in a block's Sapling tree
    fn verify_note_commitment(
        self: @TContractState,
        block_hash: u256,
        note_commitment: u256,
        proof: MerkleProof
    ) -> bool;

    /// Get block header by hash
    fn get_header(self: @TContractState, block_hash: u256) -> BlockHeader;

    /// Get block hash by height
    fn get_block_hash(self: @TContractState, height: u64) -> u256;

    /// Get current chain tip
    fn get_chain_tip(self: @TContractState) -> (u256, u64);

    /// Add a relayer
    fn add_relayer(ref self: TContractState, relayer: ContractAddress);

    /// Remove a relayer
    fn remove_relayer(ref self: TContractState, relayer: ContractAddress);

    /// Check if address is a relayer
    fn is_relayer(self: @TContractState, address: ContractAddress) -> bool;
}

#[starknet::contract]
pub mod RelaySystem {
    use starknet::{ContractAddress, get_caller_address};
    use starknet::storage::{
        StoragePointerReadAccess, StoragePointerWriteAccess,
        Map, StoragePathEntry
    };
    use zclaim::relay::types::{BlockHeader, MerkleProof, constants};

    #[storage]
    struct Storage {
        /// Block hash => Block header data
        headers: Map<u256, BlockHeader>,
        /// Block height => Block hash (for main chain)
        height_to_hash: Map<u64, u256>,
        /// Current chain tip hash
        chain_tip: u256,
        /// Current chain tip height
        chain_tip_height: u64,
        /// Genesis block hash
        genesis_hash: u256,
        /// Authorized relayers
        relayers: Map<ContractAddress, bool>,
        /// Contract owner
        owner: ContractAddress,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        BlockHeaderSubmitted: BlockHeaderSubmitted,
        ChainReorg: ChainReorg,
        RelayerAdded: RelayerAdded,
        RelayerRemoved: RelayerRemoved,
    }

    #[derive(Drop, starknet::Event)]
    pub struct BlockHeaderSubmitted {
        #[key]
        pub block_hash: u256,
        #[key]
        pub prev_block_hash: u256,
        pub height: u64,
        pub sapling_root: u256,
    }

    #[derive(Drop, starknet::Event)]
    pub struct ChainReorg {
        pub old_tip: u256,
        pub new_tip: u256,
        pub old_height: u64,
        pub new_height: u64,
    }

    #[derive(Drop, starknet::Event)]
    pub struct RelayerAdded {
        #[key]
        pub relayer: ContractAddress,
    }

    #[derive(Drop, starknet::Event)]
    pub struct RelayerRemoved {
        #[key]
        pub relayer: ContractAddress,
    }

    pub mod Errors {
        pub const NOT_OWNER: felt252 = 'Relay: not owner';
        pub const NOT_RELAYER: felt252 = 'Relay: not relayer';
        pub const PREV_BLOCK_NOT_VERIFIED: felt252 = 'Relay: prev block not verified';
        pub const INVALID_HEIGHT: felt252 = 'Relay: invalid height';
        pub const BLOCK_EXISTS: felt252 = 'Relay: block already exists';
        pub const INVALID_POW: felt252 = 'Relay: invalid PoW';
        pub const BLOCK_NOT_CONFIRMED: felt252 = 'Relay: block not confirmed';
        pub const BLOCK_NOT_FOUND: felt252 = 'Relay: block not found';
        pub const HEADER_TOO_SHORT: felt252 = 'Relay: header too short';
    }

    #[constructor]
    fn constructor(
        ref self: ContractState,
        genesis_hash: u256,
        genesis_height: u64,
        genesis_sapling_root: u256,
        owner: ContractAddress
    ) {
        self.owner.write(owner);
        self.relayers.entry(owner).write(true);

        self.genesis_hash.write(genesis_hash);
        self.chain_tip.write(genesis_hash);
        self.chain_tip_height.write(genesis_height);

        // Initialize genesis header
        let genesis_header = BlockHeader {
            block_hash: genesis_hash,
            prev_block_hash: 0_u256,
            merkle_root: 0_u256,
            sapling_root: genesis_sapling_root,
            timestamp: 0,
            bits: 0,
            height: genesis_height,
            chain_work: 0_u256,
            verified: true,
        };

        self.headers.entry(genesis_hash).write(genesis_header);
        self.height_to_hash.entry(genesis_height).write(genesis_hash);
    }

    #[abi(embed_v0)]
    impl RelaySystemImpl of super::IRelaySystem<ContractState> {
        fn submit_block_header(
            ref self: ContractState,
            header_data: Array<felt252>,
            height: u64
        ) -> u256 {
            self._only_relayer();

            // Parse header
            let (prev_block_hash, merkle_root, sapling_root, timestamp, bits) = 
                self._parse_header(@header_data);

            // Verify previous block exists
            let prev_header = self.headers.entry(prev_block_hash).read();
            assert(prev_header.verified, Errors::PREV_BLOCK_NOT_VERIFIED);
            assert(prev_header.height == height - 1, Errors::INVALID_HEIGHT);

            // Compute block hash
            let block_hash = self._compute_block_hash(@header_data);

            // Check block doesn't already exist
            let existing = self.headers.entry(block_hash).read();
            assert(!existing.verified, Errors::BLOCK_EXISTS);

            // TODO: Verify Equihash PoW
            // For now, trust relayers (to be replaced with actual verification)
            let pow_valid = self._verify_equihash(@header_data, bits);
            assert(pow_valid, Errors::INVALID_POW);

            // Calculate chain work
            let block_work = self._calculate_work(bits);
            let chain_work = prev_header.chain_work + block_work;

            // Store header
            let new_header = BlockHeader {
                block_hash,
                prev_block_hash,
                merkle_root,
                sapling_root,
                timestamp,
                bits,
                height,
                chain_work,
                verified: true,
            };
            self.headers.entry(block_hash).write(new_header);

            // Update chain tip if this extends heaviest chain
            let current_tip = self.chain_tip.read();
            let current_tip_header = self.headers.entry(current_tip).read();

            if chain_work > current_tip_header.chain_work {
                if prev_block_hash != current_tip {
                    self.emit(ChainReorg {
                        old_tip: current_tip,
                        new_tip: block_hash,
                        old_height: self.chain_tip_height.read(),
                        new_height: height,
                    });
                }

                self.chain_tip.write(block_hash);
                self.chain_tip_height.write(height);
                self.height_to_hash.entry(height).write(block_hash);
            }

            self.emit(BlockHeaderSubmitted {
                block_hash,
                prev_block_hash,
                height,
                sapling_root,
            });

            block_hash
        }

        fn submit_block_headers_batch(
            ref self: ContractState,
            headers: Array<Array<felt252>>,
            start_height: u64
        ) {
            let mut i: u64 = 0;
            let len = headers.len();
            
            loop {
                if i >= len.into() {
                    break;
                }
                let header = headers.at(i.try_into().unwrap()).clone();
                self.submit_block_header(header, start_height + i);
                i += 1;
            }
        }

        fn is_confirmed(self: @ContractState, block_hash: u256) -> bool {
            let header = self.headers.entry(block_hash).read();
            if !header.verified {
                return false;
            }

            let tip_height = self.chain_tip_height.read();
            tip_height >= header.height + constants::MIN_CONFIRMATIONS
        }

        fn get_sapling_root(self: @ContractState, block_hash: u256) -> u256 {
            assert(self.is_confirmed(block_hash), Errors::BLOCK_NOT_CONFIRMED);
            let header = self.headers.entry(block_hash).read();
            header.sapling_root
        }

        fn verify_note_commitment(
            self: @ContractState,
            block_hash: u256,
            note_commitment: u256,
            proof: MerkleProof
        ) -> bool {
            assert(self.is_confirmed(block_hash), Errors::BLOCK_NOT_CONFIRMED);

            let header = self.headers.entry(block_hash).read();
            let sapling_root = header.sapling_root;

            // Verify Merkle proof using SHA256d
            zclaim::crypto::merkle::verify_merkle_proof(note_commitment, sapling_root, proof)
        }

        fn get_header(self: @ContractState, block_hash: u256) -> BlockHeader {
            self.headers.entry(block_hash).read()
        }

        fn get_block_hash(self: @ContractState, height: u64) -> u256 {
            self.height_to_hash.entry(height).read()
        }

        fn get_chain_tip(self: @ContractState) -> (u256, u64) {
            (self.chain_tip.read(), self.chain_tip_height.read())
        }

        fn add_relayer(ref self: ContractState, relayer: ContractAddress) {
            self._only_owner();
            self.relayers.entry(relayer).write(true);
            self.emit(RelayerAdded { relayer });
        }

        fn remove_relayer(ref self: ContractState, relayer: ContractAddress) {
            self._only_owner();
            self.relayers.entry(relayer).write(false);
            self.emit(RelayerRemoved { relayer });
        }

        fn is_relayer(self: @ContractState, address: ContractAddress) -> bool {
            self.relayers.entry(address).read()
        }
    }

    #[generate_trait]
    impl InternalImpl of InternalTrait {
        fn _only_owner(self: @ContractState) {
            let caller = get_caller_address();
            let owner = self.owner.read();
            assert(caller == owner, Errors::NOT_OWNER);
        }

        fn _only_relayer(self: @ContractState) {
            let caller = get_caller_address();
            assert(self.relayers.entry(caller).read(), Errors::NOT_RELAYER);
        }

        /// Parse Zcash block header components
        /// Header structure:
        /// - version: 4 bytes
        /// - prevBlockHash: 32 bytes
        /// - merkleRoot: 32 bytes
        /// - hashFinalSaplingRoot: 32 bytes
        /// - nTime: 4 bytes
        /// - nBits: 4 bytes
        /// - nNonce: 32 bytes
        /// - solution: variable (1344 bytes for Equihash)
        fn _parse_header(
            self: @ContractState,
            header: @Array<felt252>
        ) -> (u256, u256, u256, u64, u32) {
            // Simplified parsing - in production, properly decode the bytes
            // For now, assume header is passed as structured felt252 array:
            // [0-1]: prev_block_hash (u256 = 2 x felt252)
            // [2-3]: merkle_root
            // [4-5]: sapling_root
            // [6]: timestamp (u64)
            // [7]: bits (u32)
            
            assert(header.len() >= 8, Errors::HEADER_TOO_SHORT);

            let prev_hash_low: felt252 = *header.at(0);
            let prev_hash_high: felt252 = *header.at(1);
            let prev_block_hash: u256 = u256 {
                low: prev_hash_low.try_into().unwrap(),
                high: prev_hash_high.try_into().unwrap(),
            };

            let merkle_low: felt252 = *header.at(2);
            let merkle_high: felt252 = *header.at(3);
            let merkle_root: u256 = u256 {
                low: merkle_low.try_into().unwrap(),
                high: merkle_high.try_into().unwrap(),
            };

            let sapling_low: felt252 = *header.at(4);
            let sapling_high: felt252 = *header.at(5);
            let sapling_root: u256 = u256 {
                low: sapling_low.try_into().unwrap(),
                high: sapling_high.try_into().unwrap(),
            };

            let timestamp: u64 = (*header.at(6)).try_into().unwrap();
            let bits: u32 = (*header.at(7)).try_into().unwrap();

            (prev_block_hash, merkle_root, sapling_root, timestamp, bits)
        }

        /// Compute block hash using BLAKE2b-256 with Zcash personalization
        fn _compute_block_hash(self: @ContractState, header: @Array<felt252>) -> u256 {
            // BLAKE2b-256 with "ZcashBlockHash" personalization (16 bytes)
            let personalization: Array<u8> = array![
                0x5a, 0x63, 0x61, 0x73, 0x68, 0x42, 0x6c, 0x6f, // "ZcashBlo"
                0x63, 0x6b, 0x48, 0x61, 0x73, 0x68, 0x00, 0x00  // "ckHash\0\0"
            ];
            zclaim::crypto::blake2b::blake2b_256_personalized(header, @personalization)
        }

        /// Verify Equihash proof-of-work
        /// Equihash(200, 9) used by Zcash
        fn _verify_equihash(self: @ContractState, header: @Array<felt252>, bits: u32) -> bool {
            // Equihash verification steps:
            // 1. Extract nonce and solution from header
            // 2. Compute BLAKE2b-256 seeded hash
            // 3. Verify solution meets difficulty target
            
            // Get the difficulty target from bits
            let target = self._bits_to_target(bits);
            
            // Compute block hash
            let block_hash = self._compute_block_hash(header);
            
            // Verify hash meets target: hash <= target
            // Note: In Zcash, the solution must also satisfy Equihash constraints
            // Full Equihash verification is expensive; for production:
            // - Use STARK proof of Equihash verification
            // - Or trust bonded relayers with slashing for invalid blocks
            
            // Check difficulty: block_hash must be less than target
            verify_hash_meets_target(block_hash, target)
        }
        
        /// Convert compact bits to target threshold
        fn _bits_to_target(self: @ContractState, bits: u32) -> u256 {
            let exponent: u32 = bits / 0x1000000;
            let mantissa: u256 = (bits & 0x007fffff).into();
            
            if exponent == 0 {
                return mantissa;
            } else if exponent <= 3 {
                return mantissa / pow2((3 - exponent) * 8);
            } else {
                return mantissa * pow2((exponent - 3) * 8);
            }
        }

        /// Calculate work from difficulty bits
        fn _calculate_work(self: @ContractState, bits: u32) -> u256 {
            // Extract exponent and mantissa from compact bits
            let exponent: u32 = bits / 0x1000000; // >> 24
            let mantissa: u256 = (bits & 0x007fffff).into();

            if exponent == 0 {
                return 0_u256;
            }

            // Calculate target
            let shift = if exponent <= 3 { 0 } else { (exponent - 3) * 8 };
            let target = mantissa * pow2(shift);

            if target == 0_u256 {
                return 0_u256;
            }

            // Work = 2^256 / (target + 1)
            // Approximation for Cairo
            let max_u256: u256 = 0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff_u256;
            max_u256 / (target + 1_u256)
        }
    }

    /// Helper: Power of 2
    fn pow2(exp: u32) -> u256 {
        let mut result: u256 = 1;
        let mut i: u32 = 0;
        loop {
            if i >= exp {
                break;
            }
            result = result * 2;
            i += 1;
        };
        result
    }

    /// Verify block hash meets difficulty target
    fn verify_hash_meets_target(hash: u256, target: u256) -> bool {
        // Hash must be less than or equal to target
        // Lower hash = more work done
        hash <= target
    }
}
