use starknet::ContractAddress;
use snforge_std::{
  declare, ContractClassTrait, DeclareResultTrait,
  start_cheat_caller_address, stop_cheat_caller_address,
};
use zarklink::zcash_relay::{
  IZcashRelayDispatcher, IZcashRelayDispatcherTrait, BlockHeader
};
use core::poseidon::poseidon_hash_span;

fn OWNER() -> ContractAddress {
  1.try_into().unwrap()
}

fn RELAYER1() -> ContractAddress {
  2.try_into().unwrap()
}

fn RELAYER2() -> ContractAddress {
  3.try_into().unwrap()
}

fn RANDOM_USER() -> ContractAddress {
  4.try_into().unwrap()
}

const FINALITY_DEPTH: u32 = 6;

fn deploy_relay() -> (ContractAddress, IZcashRelayDispatcher) {
  let contract = declare("ZcashRelay").unwrap().contract_class();
  let mut calldata: Array<felt252> = array![];
  calldata.append(OWNER().into());
  calldata.append(FINALITY_DEPTH.into());
  let (addr, _) = contract.deploy(@calldata).unwrap();
  (addr, IZcashRelayDispatcher { contract_address: addr })
}

// Compute block hash the same way the relay contract does
fn compute_block_hash(header: @BlockHeader) -> felt252 {
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

fn make_header(height: u32, prev_hash: felt252) -> BlockHeader {
  BlockHeader {
    version: 4,
    prev_block_hash: prev_hash,
    merkle_root: height.into(),
    commitment_root: (height * 100).into(),
    timestamp: 1700000000 + height * 75,
    bits: 0x2007ffff,
    nonce: height.into(),
    block_height: height,
  }
}

// Build a chain of headers with proper prev_block_hash linkage
fn build_chain(count: u32) -> Array<BlockHeader> {
  let mut headers: Array<BlockHeader> = array![];
  let mut prev_hash: felt252 = 0;
  let mut i: u32 = 0;
  while i < count {
    let header = make_header(i, prev_hash);
    prev_hash = compute_block_hash(@header);
    headers.append(header);
    i += 1;
  };
  headers
}

// -- Basic deploy tests --

#[test]
fn test_initial_state() {
  let (_, relay) = deploy_relay();
  assert(relay.get_chain_tip() == 0, 'initial tip 0');
  assert(relay.get_header_count() == 0, 'initial count 0');
  assert(relay.get_finalized_height() == 0, 'initial finalized 0');
}

#[test]
fn test_owner_is_authorized_relayer() {
  let (_, relay) = deploy_relay();
  assert(relay.is_relayer_authorized(OWNER()), 'owner is relayer');
}

// -- Header submission --

#[test]
fn test_submit_first_header() {
  let (addr, relay) = deploy_relay();
  let header = make_header(0, 0);

  start_cheat_caller_address(addr, OWNER());
  relay.submit_header(header);
  stop_cheat_caller_address(addr);

  assert(relay.get_header_count() == 1, 'count should be 1');
  let stored = relay.get_header(0);
  assert(stored.version == 4, 'version mismatch');
  assert(stored.block_height == 0, 'height mismatch');
}

#[test]
fn test_submit_chain_of_headers() {
  let (addr, relay) = deploy_relay();
  let chain = build_chain(5);

  start_cheat_caller_address(addr, OWNER());
  let mut i: u32 = 0;
  while i < 5 {
    relay.submit_header(*chain.at(i));
    i += 1;
  };
  stop_cheat_caller_address(addr);

  assert(relay.get_chain_tip() == 4, 'tip should be 4');
  assert(relay.get_header_count() == 5, 'count should be 5');
}

// -- Batch submission --

#[test]
fn test_submit_headers_batch() {
  let (addr, relay) = deploy_relay();
  let chain = build_chain(4);

  start_cheat_caller_address(addr, OWNER());
  relay.submit_headers_batch(chain.span());
  stop_cheat_caller_address(addr);

  assert(relay.get_chain_tip() == 3, 'batch tip');
  assert(relay.get_header_count() == 4, 'batch count');
}

// -- Authorization --

#[test]
#[should_panic]
fn test_unauthorized_cannot_submit() {
  let (addr, relay) = deploy_relay();
  start_cheat_caller_address(addr, RANDOM_USER());
  relay.submit_header(make_header(0, 0));
  stop_cheat_caller_address(addr);
}

#[test]
fn test_authorize_relayer() {
  let (addr, relay) = deploy_relay();

  start_cheat_caller_address(addr, OWNER());
  relay.authorize_relayer(RELAYER1());
  stop_cheat_caller_address(addr);

  assert(relay.is_relayer_authorized(RELAYER1()), 'should be authorized');

  start_cheat_caller_address(addr, RELAYER1());
  relay.submit_header(make_header(0, 0));
  stop_cheat_caller_address(addr);

  assert(relay.get_header_count() == 1, 'relayer1 submitted');
}

#[test]
fn test_revoke_relayer() {
  let (addr, relay) = deploy_relay();

  start_cheat_caller_address(addr, OWNER());
  relay.authorize_relayer(RELAYER1());
  relay.revoke_relayer(RELAYER1());
  stop_cheat_caller_address(addr);

  assert(!relay.is_relayer_authorized(RELAYER1()), 'should be revoked');
}

#[test]
#[should_panic]
fn test_non_owner_cannot_authorize() {
  let (addr, relay) = deploy_relay();
  start_cheat_caller_address(addr, RANDOM_USER());
  relay.authorize_relayer(RELAYER2());
  stop_cheat_caller_address(addr);
}

// -- Finality --

#[test]
fn test_finality_not_reached() {
  let (addr, relay) = deploy_relay();
  let chain = build_chain(3);

  start_cheat_caller_address(addr, OWNER());
  let mut i: u32 = 0;
  while i < 3 {
    relay.submit_header(*chain.at(i));
    i += 1;
  };
  stop_cheat_caller_address(addr);

  // tip=2, depth=6 -> finalized only if tip >= depth, which is false
  assert(!relay.is_finalized(0), 'not finalized yet');
  assert(relay.get_finalized_height() == 0, 'finalized height 0');
}

#[test]
fn test_finality_reached() {
  let (addr, relay) = deploy_relay();
  let chain = build_chain(9);

  start_cheat_caller_address(addr, OWNER());
  let mut i: u32 = 0;
  while i < 9 {
    relay.submit_header(*chain.at(i));
    i += 1;
  };
  stop_cheat_caller_address(addr);

  // tip=8, finality_depth=6, finalized <= 8-6 = 2
  assert(relay.get_chain_tip() == 8, 'tip 8');
  assert(relay.get_finalized_height() == 2, 'finalized 2');
  assert(relay.is_finalized(0), 'block 0 finalized');
  assert(relay.is_finalized(2), 'block 2 finalized');
  assert(!relay.is_finalized(3), 'block 3 not finalized');
}

// -- Finality depth management --

#[test]
fn test_set_finality_depth() {
  let (addr, relay) = deploy_relay();

  start_cheat_caller_address(addr, OWNER());
  relay.set_finality_depth(10);
  stop_cheat_caller_address(addr);

  let chain = build_chain(9);
  start_cheat_caller_address(addr, OWNER());
  let mut i: u32 = 0;
  while i < 9 {
    relay.submit_header(*chain.at(i));
    i += 1;
  };
  stop_cheat_caller_address(addr);

  // tip=8, new depth=10 -> finalized only if tip >= depth -> 8 >= 10 false
  assert(!relay.is_finalized(0), 'not finalized at depth 10');
}

#[test]
#[should_panic]
fn test_set_finality_depth_too_low() {
  let (addr, relay) = deploy_relay();
  start_cheat_caller_address(addr, OWNER());
  relay.set_finality_depth(5);
  stop_cheat_caller_address(addr);
}

// -- Commitment root storage --

#[test]
fn test_commitment_root_stored() {
  let (addr, relay) = deploy_relay();

  start_cheat_caller_address(addr, OWNER());
  relay.submit_header(make_header(0, 0));
  stop_cheat_caller_address(addr);

  let root = relay.get_commitment_root(0);
  // height 0 => commitment_root = 0*100 = 0
  assert(root == 0, 'root for h0 is 0');
}

#[test]
fn test_commitment_root_nonzero() {
  let (addr, relay) = deploy_relay();

  // Submit header at height 5 directly (no continuity check since stored hash at 4 = 0)
  start_cheat_caller_address(addr, OWNER());
  relay.submit_header(make_header(5, 0));
  stop_cheat_caller_address(addr);

  let root = relay.get_commitment_root(5);
  assert(root == 500, 'commitment 5*100=500');
}

// -- Chain continuity enforcement --

#[test]
#[should_panic]
fn test_bad_prev_hash_rejected() {
  let (addr, relay) = deploy_relay();

  // Submit block 0
  start_cheat_caller_address(addr, OWNER());
  relay.submit_header(make_header(0, 0));
  // Block 1 with wrong prev_hash (should be hash of block 0, not 999)
  relay.submit_header(make_header(1, 999));
  stop_cheat_caller_address(addr);
}
