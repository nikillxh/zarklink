use starknet::ContractAddress;
use starknet::contract_address_const;
use snforge_std::{
  declare, ContractClassTrait, DeclareResultTrait,
  start_cheat_caller_address, stop_cheat_caller_address,
  start_cheat_block_timestamp, stop_cheat_block_timestamp,
};
use zarklink::bridge_protocol::{
  IBridgeProtocolDispatcher, IBridgeProtocolDispatcherTrait,
  IssueState, RedeemState,
};
use zarklink::vault_pool::{IVaultPoolDispatcher, IVaultPoolDispatcherTrait};
use zarklink::vault_registry::{IVaultRegistryDispatcher, IVaultRegistryDispatcherTrait};
use zarklink::zcash_relay::{IZcashRelayDispatcher, IZcashRelayDispatcherTrait, BlockHeader};
use zarklink::wzec_token::{IWzecTokenDispatcher, IWzecTokenDispatcherTrait};
use core::poseidon::poseidon_hash_span;

fn OWNER() -> ContractAddress {
  contract_address_const::<1>()
}

fn ISSUER() -> ContractAddress {
  contract_address_const::<2>()
}

fn VAULT_OP1() -> ContractAddress {
  contract_address_const::<3>()
}

fn RANDOM_USER() -> ContractAddress {
  contract_address_const::<5>()
}

fn COLLATERAL_TOKEN() -> ContractAddress {
  contract_address_const::<6>()
}

const FEE_RATE: u256 = 100; // 1%
const WARRANTY_AMOUNT: u256 = 10;
const MINT_DEADLINE: u64 = 3600; // 1 hour
const CONFIRM_ISSUE_DEADLINE: u64 = 7200; // 2 hours
const CONFIRM_REDEEM_DEADLINE: u64 = 7200;
const COLLATERAL_RATIO: u256 = 15000;
const MAX_LOCK: u256 = 100_000_000_000;
const REG_FEE_RATE: u256 = 50;

// Deploy all 5 contracts and wire them together
fn deploy_full_system() -> (
  ContractAddress, IWzecTokenDispatcher,
  ContractAddress, IZcashRelayDispatcher,
  ContractAddress, IVaultRegistryDispatcher,
  ContractAddress, IVaultPoolDispatcher,
  ContractAddress, IBridgeProtocolDispatcher,
) {
  // 1. Deploy wZEC (bridge will be set after bridge deploy)
  let wzec_class = declare("WzecToken").unwrap().contract_class();
  let mut wzec_cd: Array<felt252> = array![];
  wzec_cd.append(OWNER().into());
  wzec_cd.append(OWNER().into()); // temporary bridge = owner
  let (wzec_addr, _) = wzec_class.deploy(@wzec_cd).unwrap();
  let wzec = IWzecTokenDispatcher { contract_address: wzec_addr };

  // 2. Deploy Zcash Relay (finality_depth = 6)
  let relay_class = declare("ZcashRelay").unwrap().contract_class();
  let mut relay_cd: Array<felt252> = array![];
  relay_cd.append(OWNER().into());
  relay_cd.append(6_felt252);
  let (relay_addr, _) = relay_class.deploy(@relay_cd).unwrap();
  let relay = IZcashRelayDispatcher { contract_address: relay_addr };

  // 3. Deploy Vault Registry
  let reg_class = declare("VaultRegistry").unwrap().contract_class();
  let mut reg_cd: Array<felt252> = array![];
  reg_cd.append(OWNER().into());
  reg_cd.append(COLLATERAL_TOKEN().into());
  reg_cd.append(COLLATERAL_RATIO.low.into());
  reg_cd.append(COLLATERAL_RATIO.high.into());
  reg_cd.append(MAX_LOCK.low.into());
  reg_cd.append(MAX_LOCK.high.into());
  reg_cd.append(REG_FEE_RATE.low.into());
  reg_cd.append(REG_FEE_RATE.high.into());
  let (reg_addr, _) = reg_class.deploy(@reg_cd).unwrap();
  let registry = IVaultRegistryDispatcher { contract_address: reg_addr };

  // 4. Deploy Vault Pool
  let pool_class = declare("VaultPool").unwrap().contract_class();
  let mut pool_cd: Array<felt252> = array![];
  pool_cd.append(OWNER().into());
  pool_cd.append(reg_addr.into());
  pool_cd.append(COLLATERAL_TOKEN().into());
  let (pool_addr, _) = pool_class.deploy(@pool_cd).unwrap();
  let pool = IVaultPoolDispatcher { contract_address: pool_addr };

  // 5. Deploy Bridge Protocol
  let bridge_class = declare("BridgeProtocol").unwrap().contract_class();
  let mut bridge_cd: Array<felt252> = array![];
  bridge_cd.append(OWNER().into());
  bridge_cd.append(reg_addr.into());
  bridge_cd.append(pool_addr.into());
  bridge_cd.append(relay_addr.into());
  bridge_cd.append(wzec_addr.into());
  bridge_cd.append(MINT_DEADLINE.into());
  bridge_cd.append(CONFIRM_ISSUE_DEADLINE.into());
  bridge_cd.append(CONFIRM_REDEEM_DEADLINE.into());
  bridge_cd.append(FEE_RATE.low.into());
  bridge_cd.append(FEE_RATE.high.into());
  bridge_cd.append(WARRANTY_AMOUNT.low.into());
  bridge_cd.append(WARRANTY_AMOUNT.high.into());
  let (bridge_addr, _) = bridge_class.deploy(@bridge_cd).unwrap();
  let bridge = IBridgeProtocolDispatcher { contract_address: bridge_addr };

  // Wire contracts together
  // Set bridge on wZEC token
  start_cheat_caller_address(wzec_addr, OWNER());
  wzec.set_bridge(bridge_addr);
  stop_cheat_caller_address(wzec_addr);

  // Set bridge on vault registry
  start_cheat_caller_address(reg_addr, OWNER());
  registry.set_bridge_protocol(bridge_addr);
  stop_cheat_caller_address(reg_addr);

  // Set bridge on vault pool
  start_cheat_caller_address(pool_addr, OWNER());
  pool.set_bridge_protocol(bridge_addr);
  stop_cheat_caller_address(pool_addr);

  (wzec_addr, wzec, relay_addr, relay, reg_addr, registry, pool_addr, pool, bridge_addr, bridge)
}

// Helper: register vault and deposit into pool
fn setup_vault(
  reg_addr: ContractAddress,
  registry: IVaultRegistryDispatcher,
  pool_addr: ContractAddress,
  pool: IVaultPoolDispatcher,
  operator: ContractAddress,
  collateral: u256,
) {
  start_cheat_caller_address(reg_addr, operator);
  registry.register_vault(111, 222);
  registry.deposit_collateral(collateral);
  stop_cheat_caller_address(reg_addr);

  start_cheat_caller_address(pool_addr, operator);
  pool.deposit_collateral(collateral);
  stop_cheat_caller_address(pool_addr);
}

// Helper: submit enough relay headers for finalized blocks
fn submit_relay_headers(
  relay_addr: ContractAddress,
  relay: IZcashRelayDispatcher,
  count: u32,
) {
  start_cheat_caller_address(relay_addr, OWNER());
  let mut prev_hash: felt252 = 0;
  let mut i: u32 = 0;
  while i < count {
    let header = BlockHeader {
      version: 4,
      prev_block_hash: prev_hash,
      merkle_root: i.into(),
      commitment_root: (i * 100).into(),
      timestamp: 1700000000 + i * 75,
      bits: 0x2007ffff,
      nonce: i.into(),
      block_height: i,
    };
    // Compute hash for next header's prev_block_hash
    let hash_input = array![
      4_felt252,
      prev_hash,
      i.into(),
      (i * 100).into(),
      (1700000000 + i * 75).into(),
      0x2007ffff_felt252,
      i.into(),
      i.into(),
    ];
    prev_hash = poseidon_hash_span(hash_input.span());
    relay.submit_header(header);
    i += 1;
  };
  stop_cheat_caller_address(relay_addr);
}

// -- Admin tests --

#[test]
fn test_initial_config() {
  let (_, _, _, _, _, _, _, _, _, bridge) = deploy_full_system();
  assert(bridge.get_fee_rate() == FEE_RATE, 'fee rate');
  assert(bridge.get_warranty_amount() == WARRANTY_AMOUNT, 'warranty');
  assert(bridge.get_issue_count() == 0, 'issue count');
  assert(bridge.get_redeem_count() == 0, 'redeem count');
}

#[test]
fn test_set_fee_rate() {
  let (_, _, _, _, _, _, _, _, bridge_addr, bridge) = deploy_full_system();
  start_cheat_caller_address(bridge_addr, OWNER());
  bridge.set_fee_rate(200); // 2%
  stop_cheat_caller_address(bridge_addr);
  assert(bridge.get_fee_rate() == 200, 'fee updated');
}

#[test]
#[should_panic]
fn test_set_fee_rate_too_high() {
  let (_, _, _, _, _, _, _, _, bridge_addr, bridge) = deploy_full_system();
  start_cheat_caller_address(bridge_addr, OWNER());
  bridge.set_fee_rate(1001); // > 10%
  stop_cheat_caller_address(bridge_addr);
}

#[test]
#[should_panic]
fn test_set_fee_rate_non_owner() {
  let (_, _, _, _, _, _, _, _, bridge_addr, bridge) = deploy_full_system();
  start_cheat_caller_address(bridge_addr, RANDOM_USER());
  bridge.set_fee_rate(200);
  stop_cheat_caller_address(bridge_addr);
}

#[test]
fn test_set_warranty_amount() {
  let (_, _, _, _, _, _, _, _, bridge_addr, bridge) = deploy_full_system();
  start_cheat_caller_address(bridge_addr, OWNER());
  bridge.set_warranty_amount(50);
  stop_cheat_caller_address(bridge_addr);
  assert(bridge.get_warranty_amount() == 50, 'warranty updated');
}

// -- Issue Flow: request_lock --

#[test]
fn test_request_lock() {
  let (_, _, _, _, reg_addr, registry, pool_addr, pool, bridge_addr, bridge) = deploy_full_system();
  setup_vault(reg_addr, registry, pool_addr, pool, VAULT_OP1(), 10000);

  start_cheat_caller_address(bridge_addr, ISSUER());
  let (request_id, lock_nonce) = bridge.request_lock(1000, 10);
  stop_cheat_caller_address(bridge_addr);

  assert(request_id != 0, 'request id nonzero');
  assert(lock_nonce != 0, 'lock nonce nonzero');
  assert(bridge.get_issue_count() == 1, 'issue count 1');

  let req = bridge.get_issue_request(request_id);
  assert(req.issuer == ISSUER(), 'issuer matches');
  assert(req.mint_amount == 1000, 'mint amount');
  assert(req.warranty_collateral == 10, 'warranty');
  assert(req.state == IssueState::AwaitingMint, 'state awaiting');
}

#[test]
#[should_panic]
fn test_request_lock_zero_amount_fails() {
  let (_, _, _, _, reg_addr, registry, pool_addr, pool, bridge_addr, bridge) = deploy_full_system();
  setup_vault(reg_addr, registry, pool_addr, pool, VAULT_OP1(), 10000);

  start_cheat_caller_address(bridge_addr, ISSUER());
  bridge.request_lock(0, 10);
  stop_cheat_caller_address(bridge_addr);
}

#[test]
#[should_panic]
fn test_request_lock_low_warranty_fails() {
  let (_, _, _, _, reg_addr, registry, pool_addr, pool, bridge_addr, bridge) = deploy_full_system();
  setup_vault(reg_addr, registry, pool_addr, pool, VAULT_OP1(), 10000);

  start_cheat_caller_address(bridge_addr, ISSUER());
  bridge.request_lock(1000, 5); // warranty < 10 minimum
  stop_cheat_caller_address(bridge_addr);
}

// -- Issue Flow: expire_issue --

#[test]
fn test_expire_issue_after_deadline() {
  let (_, _, _, _, reg_addr, registry, pool_addr, pool, bridge_addr, bridge) = deploy_full_system();
  setup_vault(reg_addr, registry, pool_addr, pool, VAULT_OP1(), 10000);

  // Create issue at timestamp 100
  start_cheat_block_timestamp(bridge_addr, 100);
  start_cheat_caller_address(bridge_addr, ISSUER());
  let (request_id, _) = bridge.request_lock(1000, 10);
  stop_cheat_caller_address(bridge_addr);
  stop_cheat_block_timestamp(bridge_addr);

  // Deadline = 100 + 3600 = 3700
  // Expire at timestamp 3701
  start_cheat_block_timestamp(bridge_addr, 3701);
  bridge.expire_issue(request_id);
  stop_cheat_block_timestamp(bridge_addr);

  let req = bridge.get_issue_request(request_id);
  assert(req.state == IssueState::IssueExpired, 'should be expired');
}

#[test]
#[should_panic]
fn test_expire_issue_before_deadline_fails() {
  let (_, _, _, _, reg_addr, registry, pool_addr, pool, bridge_addr, bridge) = deploy_full_system();
  setup_vault(reg_addr, registry, pool_addr, pool, VAULT_OP1(), 10000);

  start_cheat_block_timestamp(bridge_addr, 100);
  start_cheat_caller_address(bridge_addr, ISSUER());
  let (request_id, _) = bridge.request_lock(1000, 10);
  stop_cheat_caller_address(bridge_addr);

  // Try to expire before deadline (still at 100, deadline = 3700)
  bridge.expire_issue(request_id);
  stop_cheat_block_timestamp(bridge_addr);
}

// -- Full Issue Flow with cross-contract calls --

#[test]
fn test_full_issue_flow() {
  let (
    wzec_addr, wzec,
    relay_addr, relay,
    reg_addr, registry,
    pool_addr, pool,
    bridge_addr, bridge
  ) = deploy_full_system();

  // Setup vault with collateral
  setup_vault(reg_addr, registry, pool_addr, pool, VAULT_OP1(), 50000);

  // Submit relay headers (9 headers = block 0..8, finalized through block 2)
  submit_relay_headers(relay_addr, relay, 9);

  // Step 1: Request lock
  start_cheat_block_timestamp(bridge_addr, 100);
  start_cheat_caller_address(bridge_addr, ISSUER());
  let (request_id, _lock_nonce) = bridge.request_lock(1000, 10);
  stop_cheat_caller_address(bridge_addr);

  let req = bridge.get_issue_request(request_id);
  assert(req.state == IssueState::AwaitingMint, 'step1: awaiting');

  // Step 2: Submit mint proof (block 1 is finalized, commitment_root=100)
  // With note_commitment=100 and empty merkle path, verify_inclusion checks 100==100
  let note_commitment: felt252 = 100;
  let inclusion_proof: Array<felt252> = array![];
  let note_ciphertext_hash: felt252 = 42;
  let zk_proof = array![1, 2, 3];

  // We need to cheat relay's block_timestamp too for finality check
  start_cheat_block_timestamp(relay_addr, 100);
  start_cheat_caller_address(bridge_addr, ISSUER());
  bridge.submit_mint(
    request_id,
    note_commitment,
    inclusion_proof.span(),
    1, // block_height 1 (finalized, commitment_root = 100)
    note_ciphertext_hash,
    zk_proof.span(),
  );
  stop_cheat_caller_address(bridge_addr);
  stop_cheat_block_timestamp(bridge_addr);
  stop_cheat_block_timestamp(relay_addr);

  let req2 = bridge.get_issue_request(request_id);
  assert(req2.state == IssueState::AwaitIssueConfirm, 'step2: confirm');

  // Step 3: Vault confirms -> mint wZEC
  start_cheat_caller_address(bridge_addr, VAULT_OP1());
  bridge.confirm_issue(request_id);
  stop_cheat_caller_address(bridge_addr);

  let req3 = bridge.get_issue_request(request_id);
  assert(req3.state == IssueState::IssueSuccess, 'step3: success');

  // Check wZEC was minted (1000 - 1% fee = 990)
  let balance = wzec.balance_of(ISSUER());
  assert(balance == 990, 'issuer got 990 wZEC');

  assert(bridge.get_issue_count() == 1, 'issue count final');
}

// -- Multiple locks --

#[test]
fn test_multiple_request_locks() {
  let (_, _, _, _, reg_addr, registry, pool_addr, pool, bridge_addr, bridge) = deploy_full_system();
  setup_vault(reg_addr, registry, pool_addr, pool, VAULT_OP1(), 50000);

  start_cheat_caller_address(bridge_addr, ISSUER());
  let (id1, _) = bridge.request_lock(1000, 10);
  let (id2, _) = bridge.request_lock(2000, 20);
  stop_cheat_caller_address(bridge_addr);

  assert(id1 != id2, 'unique IDs');
  assert(bridge.get_issue_count() == 2, 'count 2');
}
