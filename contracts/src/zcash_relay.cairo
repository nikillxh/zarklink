// ============================================================================
// Zarklink — Zcash Relay Contract (Light Client)
// ============================================================================
// Verifies and stores Zcash block headers on Starknet. Provides note
// inclusion proof verification against stored commitment tree roots.
// Includes relayer authorization, chain continuity checks, and reorg
// protection.

#[derive(Drop, Serde, starknet::Store, Copy)]
pub struct BlockHeader {
  pub version: u32,
  pub prev_block_hash: felt252,
  pub merkle_root: felt252,
  pub commitment_root: felt252,
  pub timestamp: u32,
  pub bits: u32,
  pub nonce: felt252,
  pub block_height: u32,
}

#[starknet::interface]
pub trait IZcashRelay<TContractState> {
  fn submit_header(ref self: TContractState, header: BlockHeader);
  fn submit_headers_batch(ref self: TContractState, headers: Span<BlockHeader>);
  fn verify_inclusion(
    self: @TContractState,
    note_commitment: felt252,
    merkle_path: Span<felt252>,
    block_height: u32,
  ) -> bool;
  fn authorize_relayer(ref self: TContractState, relayer: ContractAddress);
  fn revoke_relayer(ref self: TContractState, relayer: ContractAddress);
  fn set_finality_depth(ref self: TContractState, depth: u32);
  fn get_chain_tip(self: @TContractState) -> u32;
  fn get_finalized_height(self: @TContractState) -> u32;
  fn get_header(self: @TContractState, block_height: u32) -> BlockHeader;
  fn get_commitment_root(self: @TContractState, block_height: u32) -> felt252;
  fn is_finalized(self: @TContractState, block_height: u32) -> bool;
  fn is_relayer_authorized(self: @TContractState, relayer: ContractAddress) -> bool;
  fn get_header_count(self: @TContractState) -> u32;
}

use starknet::ContractAddress;

#[starknet::contract]
pub mod ZcashRelay {
  use super::{BlockHeader, IZcashRelay};
  use starknet::{ContractAddress, get_caller_address};
  use starknet::storage::{
    Map, StorageMapReadAccess, StorageMapWriteAccess,
    StoragePointerReadAccess, StoragePointerWriteAccess,
  };
  use core::poseidon::poseidon_hash_span;

  // Maximum reorg depth we tolerate (24 blocks for Zcash Sapling)
  const MAX_REORG_DEPTH: u32 = 24;

  #[storage]
  struct Storage {
    owner: ContractAddress,
    chain_tip: u32,
    finality_depth: u32,
    headers: Map<u32, BlockHeader>,
    commitment_roots: Map<u32, felt252>,
    block_hashes: Map<u32, felt252>,
    authorized_relayers: Map<ContractAddress, bool>,
    header_count: u32,
    genesis_height: u32,
  }

  #[event]
  #[derive(Drop, starknet::Event)]
  pub enum Event {
    HeaderSubmitted: HeaderSubmitted,
    InclusionVerified: InclusionVerified,
    RelayerAuthorized: RelayerAuthorized,
    RelayerRevoked: RelayerRevoked,
    ChainReorg: ChainReorg,
  }

  #[derive(Drop, starknet::Event)]
  pub struct HeaderSubmitted {
    #[key]
    pub block_height: u32,
    pub commitment_root: felt252,
    pub relayer: ContractAddress,
  }

  #[derive(Drop, starknet::Event)]
  pub struct InclusionVerified {
    pub note_commitment: felt252,
    pub block_height: u32,
  }

  #[derive(Drop, starknet::Event)]
  pub struct RelayerAuthorized {
    pub relayer: ContractAddress,
  }

  #[derive(Drop, starknet::Event)]
  pub struct RelayerRevoked {
    pub relayer: ContractAddress,
  }

  #[derive(Drop, starknet::Event)]
  pub struct ChainReorg {
    pub old_tip: u32,
    pub new_tip: u32,
    pub depth: u32,
  }

  #[constructor]
  fn constructor(
    ref self: ContractState,
    owner: ContractAddress,
    finality_depth: u32,
  ) {
    self.owner.write(owner);
    self.finality_depth.write(finality_depth);
    self.chain_tip.write(0);
    self.header_count.write(0);
    self.genesis_height.write(0);
    // Owner is automatically an authorized relayer
    self.authorized_relayers.write(owner, true);
  }

  #[generate_trait]
  impl InternalImpl of InternalTrait {
    /// Compute block hash from header fields using Poseidon
    fn compute_block_hash(self: @ContractState, header: @BlockHeader) -> felt252 {
      let hash_input = array![
        (*header.version).into(),
        *header.prev_block_hash,
        *header.merkle_root,
        *header.commitment_root,
        (*header.timestamp).into(),
        (*header.bits).into(),
        *header.nonce,
        (*header.block_height).into(),
      ];
      poseidon_hash_span(hash_input.span())
    }
  }

  #[abi(embed_v0)]
  impl ZcashRelayImpl of IZcashRelay<ContractState> {
    fn submit_header(ref self: ContractState, header: BlockHeader) {
      let caller = get_caller_address();
      // Verify caller is authorized
      assert(self.authorized_relayers.read(caller), 'Not authorized relayer');

      let height = header.block_height;

      // Verify chain continuity: prev_block_hash must match stored hash
      if height > 0 {
        let stored_prev_hash = self.block_hashes.read(height - 1);
        // Allow first header at a height, or verify continuity
        if stored_prev_hash != 0 {
          assert(
            header.prev_block_hash == stored_prev_hash,
            'Chain continuity broken',
          );
        }
      }

      // Compute and store block hash
      let block_hash = self.compute_block_hash(@header);
      self.block_hashes.write(height, block_hash);

      // Store header and commitment root
      self.headers.write(height, header);
      self.commitment_roots.write(height, header.commitment_root);

      let current_tip = self.chain_tip.read();
      if height > current_tip {
        self.chain_tip.write(height);
      } else if current_tip > 0 && height <= current_tip - MAX_REORG_DEPTH {
        // Reject headers too far behind (deep reorg protection)
        // Only for non-genesis and if already have headers
        let count = self.header_count.read();
        if count > MAX_REORG_DEPTH {
          assert(false, 'Reorg too deep');
        }
      }

      self.header_count.write(self.header_count.read() + 1);

      self.emit(HeaderSubmitted {
        block_height: height,
        commitment_root: header.commitment_root,
        relayer: caller,
      });
    }

    fn submit_headers_batch(ref self: ContractState, headers: Span<BlockHeader>) {
      let mut i: u32 = 0;
      let len = headers.len();
      while i < len {
        let header = *headers.at(i);
        self.submit_header(header);
        i += 1;
      };
    }

    fn verify_inclusion(
      self: @ContractState,
      note_commitment: felt252,
      merkle_path: Span<felt252>,
      block_height: u32,
    ) -> bool {
      // Verify the block is finalized
      assert(self.is_finalized(block_height), 'Block not finalized');

      // Get the stored commitment root for this block
      let stored_root = self.commitment_roots.read(block_height);
      assert(stored_root != 0, 'Block not found');

      // Verify Merkle path from note_commitment to stored root
      let mut current = note_commitment;
      let mut i: u32 = 0;
      let path_len = merkle_path.len();

      while i < path_len {
        let sibling = *merkle_path.at(i);
        // Hash pair (ordered by felt252 value for consistency)
        let current_u256: u256 = current.into();
        let sibling_u256: u256 = sibling.into();
        let hash_input = if current_u256 < sibling_u256 {
          array![current, sibling]
        } else {
          array![sibling, current]
        };
        current = poseidon_hash_span(hash_input.span());
        i += 1;
      };

      // Check computed root matches stored root
      current == stored_root
    }

    fn authorize_relayer(ref self: ContractState, relayer: ContractAddress) {
      let caller = get_caller_address();
      assert(caller == self.owner.read(), 'Only owner');
      self.authorized_relayers.write(relayer, true);
      self.emit(RelayerAuthorized { relayer });
    }

    fn revoke_relayer(ref self: ContractState, relayer: ContractAddress) {
      let caller = get_caller_address();
      assert(caller == self.owner.read(), 'Only owner');
      self.authorized_relayers.write(relayer, false);
      self.emit(RelayerRevoked { relayer });
    }

    fn set_finality_depth(ref self: ContractState, depth: u32) {
      let caller = get_caller_address();
      assert(caller == self.owner.read(), 'Only owner');
      assert(depth >= 6, 'Depth too low');
      self.finality_depth.write(depth);
    }

    fn get_chain_tip(self: @ContractState) -> u32 {
      self.chain_tip.read()
    }

    fn get_finalized_height(self: @ContractState) -> u32 {
      let tip = self.chain_tip.read();
      let depth = self.finality_depth.read();
      if tip > depth {
        tip - depth
      } else {
        0
      }
    }

    fn get_header(self: @ContractState, block_height: u32) -> BlockHeader {
      self.headers.read(block_height)
    }

    fn get_commitment_root(self: @ContractState, block_height: u32) -> felt252 {
      self.commitment_roots.read(block_height)
    }

    fn is_finalized(self: @ContractState, block_height: u32) -> bool {
      let tip = self.chain_tip.read();
      let depth = self.finality_depth.read();
      if tip >= depth {
        block_height <= tip - depth
      } else {
        false
      }
    }

    fn is_relayer_authorized(self: @ContractState, relayer: ContractAddress) -> bool {
      self.authorized_relayers.read(relayer)
    }

    fn get_header_count(self: @ContractState) -> u32 {
      self.header_count.read()
    }
  }
}
