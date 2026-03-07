use starknet::ContractAddress;
use snforge_std::{
  declare, ContractClassTrait, DeclareResultTrait,
  start_cheat_caller_address, stop_cheat_caller_address,
};
use zarklink::vault_registry::{
  IVaultRegistryDispatcher, IVaultRegistryDispatcherTrait, VaultStatus
};

fn OWNER() -> ContractAddress {
  1.try_into().unwrap()
}

fn VAULT_OP1() -> ContractAddress {
  2.try_into().unwrap()
}

fn VAULT_OP2() -> ContractAddress {
  3.try_into().unwrap()
}

fn BRIDGE() -> ContractAddress {
  4.try_into().unwrap()
}

fn RANDOM_USER() -> ContractAddress {
  5.try_into().unwrap()
}

fn COLLATERAL_TOKEN() -> ContractAddress {
  6.try_into().unwrap()
}

const COLLATERAL_RATIO: u256 = 15000; // 150%
const MAX_LOCK: u256 = 100_000_000_000; // 1000 ZEC
const FEE_RATE: u256 = 50; // 0.5%

fn deploy_registry() -> (ContractAddress, IVaultRegistryDispatcher) {
  let contract = declare("VaultRegistry").unwrap().contract_class();
  let mut calldata: Array<felt252> = array![];
  // constructor(owner, collateral_token, standard_collateral_ratio, max_lock_amount, fee_rate)
  calldata.append(OWNER().into());
  calldata.append(COLLATERAL_TOKEN().into());
  calldata.append(COLLATERAL_RATIO.low.into());
  calldata.append(COLLATERAL_RATIO.high.into());
  calldata.append(MAX_LOCK.low.into());
  calldata.append(MAX_LOCK.high.into());
  calldata.append(FEE_RATE.low.into());
  calldata.append(FEE_RATE.high.into());
  let (addr, _) = contract.deploy(@calldata).unwrap();
  (addr, IVaultRegistryDispatcher { contract_address: addr })
}

// -- Registration tests --

#[test]
fn test_register_vault() {
  let (addr, registry) = deploy_registry();

  start_cheat_caller_address(addr, VAULT_OP1());
  registry.register_vault(111, 222);
  stop_cheat_caller_address(addr);

  assert(registry.get_vault_count() == 1, 'count 1');

  let vault = registry.get_vault(0);
  assert(vault.owner == VAULT_OP1(), 'owner match');
  assert(vault.zcash_addr_d == 111, 'addr_d match');
  assert(vault.zcash_addr_pkd == 222, 'addr_pkd match');
  assert(vault.collateral == 0, 'no collateral');
  assert(vault.status == VaultStatus::Active, 'active status');
}

#[test]
fn test_register_multiple_vaults() {
  let (addr, registry) = deploy_registry();

  start_cheat_caller_address(addr, VAULT_OP1());
  registry.register_vault(111, 222);
  stop_cheat_caller_address(addr);

  start_cheat_caller_address(addr, VAULT_OP2());
  registry.register_vault(333, 444);
  stop_cheat_caller_address(addr);

  assert(registry.get_vault_count() == 2, 'count 2');
  assert(registry.get_vault_id_by_owner(VAULT_OP1()) == 0, 'op1 id 0');
  assert(registry.get_vault_id_by_owner(VAULT_OP2()) == 1, 'op2 id 1');
}

#[test]
#[should_panic]
fn test_double_registration_fails() {
  let (addr, registry) = deploy_registry();
  start_cheat_caller_address(addr, VAULT_OP1());
  registry.register_vault(111, 222);
  registry.register_vault(333, 444); // second registration panics
  stop_cheat_caller_address(addr);
}

// -- Collateral tests --

#[test]
fn test_deposit_collateral() {
  let (addr, registry) = deploy_registry();

  start_cheat_caller_address(addr, VAULT_OP1());
  registry.register_vault(111, 222);
  registry.deposit_collateral(1000);
  stop_cheat_caller_address(addr);

  let vault = registry.get_vault(0);
  assert(vault.collateral == 1000, 'collateral 1000');
}

#[test]
fn test_deposit_multiple_times() {
  let (addr, registry) = deploy_registry();

  start_cheat_caller_address(addr, VAULT_OP1());
  registry.register_vault(111, 222);
  registry.deposit_collateral(500);
  registry.deposit_collateral(300);
  stop_cheat_caller_address(addr);

  let vault = registry.get_vault(0);
  assert(vault.collateral == 800, 'collateral 800');
}

#[test]
fn test_withdraw_collateral() {
  let (addr, registry) = deploy_registry();

  start_cheat_caller_address(addr, VAULT_OP1());
  registry.register_vault(111, 222);
  registry.deposit_collateral(1000);
  registry.withdraw_collateral(400);
  stop_cheat_caller_address(addr);

  let vault = registry.get_vault(0);
  assert(vault.collateral == 600, 'collateral 600');
}

#[test]
#[should_panic]
fn test_withdraw_more_than_collateral_fails() {
  let (addr, registry) = deploy_registry();

  start_cheat_caller_address(addr, VAULT_OP1());
  registry.register_vault(111, 222);
  registry.deposit_collateral(100);
  registry.withdraw_collateral(200);
  stop_cheat_caller_address(addr);
}

#[test]
#[should_panic]
fn test_deposit_zero_fails() {
  let (addr, registry) = deploy_registry();

  start_cheat_caller_address(addr, VAULT_OP1());
  registry.register_vault(111, 222);
  registry.deposit_collateral(0);
  stop_cheat_caller_address(addr);
}

#[test]
#[should_panic]
fn test_deposit_without_vault_fails() {
  let (addr, registry) = deploy_registry();
  start_cheat_caller_address(addr, RANDOM_USER());
  registry.deposit_collateral(100);
  stop_cheat_caller_address(addr);
}

// -- Vault active check --

#[test]
fn test_vault_active_after_registration() {
  let (addr, registry) = deploy_registry();

  start_cheat_caller_address(addr, VAULT_OP1());
  registry.register_vault(111, 222);
  stop_cheat_caller_address(addr);

  assert(registry.is_vault_active(0), 'should be active');
}

// -- Required collateral calculation --

#[test]
fn test_required_collateral() {
  let (_, registry) = deploy_registry();
  // lock_amount * 15000 / 10000 = 1.5x
  let required = registry.get_required_collateral(100);
  assert(required == 150, 'should be 150%');
}

// -- Proof submission --

#[test]
fn test_submit_proof_of_capacity() {
  let (addr, registry) = deploy_registry();

  start_cheat_caller_address(addr, VAULT_OP1());
  registry.register_vault(111, 222);
  let proof = array![1, 2, 3];
  registry.submit_proof_of_capacity(proof.span());
  stop_cheat_caller_address(addr);
}

#[test]
fn test_submit_proof_of_balance() {
  let (addr, registry) = deploy_registry();

  start_cheat_caller_address(addr, VAULT_OP1());
  registry.register_vault(111, 222);
  let proof = array![4, 5, 6];
  registry.submit_proof_of_balance(proof.span());
  stop_cheat_caller_address(addr);
}

#[test]
fn test_insolvency_suspends_vault() {
  let (addr, registry) = deploy_registry();

  start_cheat_caller_address(addr, VAULT_OP1());
  registry.register_vault(111, 222);
  let proof = array![7, 8, 9];
  registry.submit_proof_of_insolvency(proof.span());
  stop_cheat_caller_address(addr);

  let vault = registry.get_vault(0);
  assert(vault.status == VaultStatus::Suspended, 'should be suspended');
  assert(!registry.is_vault_active(0), 'not active');
}

// -- Slash vault tests --

#[test]
fn test_slash_vault_by_bridge() {
  let (addr, registry) = deploy_registry();

  // Register vault and deposit collateral
  start_cheat_caller_address(addr, VAULT_OP1());
  registry.register_vault(111, 222);
  registry.deposit_collateral(1000);
  stop_cheat_caller_address(addr);

  // Set bridge protocol
  start_cheat_caller_address(addr, OWNER());
  registry.set_bridge_protocol(BRIDGE());
  stop_cheat_caller_address(addr);

  // Slash from bridge
  start_cheat_caller_address(addr, BRIDGE());
  registry.slash_vault(0, 300);
  stop_cheat_caller_address(addr);

  let vault = registry.get_vault(0);
  assert(vault.collateral == 700, 'collateral after slash');
}

#[test]
fn test_slash_to_zero_liquidates() {
  let (addr, registry) = deploy_registry();

  start_cheat_caller_address(addr, VAULT_OP1());
  registry.register_vault(111, 222);
  registry.deposit_collateral(100);
  stop_cheat_caller_address(addr);

  start_cheat_caller_address(addr, OWNER());
  registry.set_bridge_protocol(BRIDGE());
  stop_cheat_caller_address(addr);

  start_cheat_caller_address(addr, BRIDGE());
  registry.slash_vault(0, 100);
  stop_cheat_caller_address(addr);

  let vault = registry.get_vault(0);
  assert(vault.status == VaultStatus::Liquidated, 'should be liquidated');
}

#[test]
#[should_panic]
fn test_slash_by_non_bridge_fails() {
  let (addr, registry) = deploy_registry();

  start_cheat_caller_address(addr, VAULT_OP1());
  registry.register_vault(111, 222);
  registry.deposit_collateral(1000);
  stop_cheat_caller_address(addr);

  start_cheat_caller_address(addr, RANDOM_USER());
  registry.slash_vault(0, 100);
  stop_cheat_caller_address(addr);
}

// -- set_bridge_protocol tests --

#[test]
fn test_set_bridge_protocol() {
  let (addr, registry) = deploy_registry();

  start_cheat_caller_address(addr, OWNER());
  registry.set_bridge_protocol(BRIDGE());
  stop_cheat_caller_address(addr);
}

#[test]
#[should_panic]
fn test_set_bridge_by_non_owner_fails() {
  let (addr, registry) = deploy_registry();
  start_cheat_caller_address(addr, RANDOM_USER());
  registry.set_bridge_protocol(BRIDGE());
  stop_cheat_caller_address(addr);
}

// -- Update zcash address --

#[test]
fn test_update_zcash_address() {
  let (addr, registry) = deploy_registry();

  start_cheat_caller_address(addr, VAULT_OP1());
  registry.register_vault(111, 222);
  registry.update_vault_zcash_addr(555, 666);
  stop_cheat_caller_address(addr);

  let vault = registry.get_vault(0);
  assert(vault.zcash_addr_d == 555, 'addr_d updated');
  assert(vault.zcash_addr_pkd == 666, 'addr_pkd updated');
}

// -- Deposit reactivates suspended vault --

#[test]
fn test_deposit_reactivates_suspended() {
  let (addr, registry) = deploy_registry();

  start_cheat_caller_address(addr, VAULT_OP1());
  registry.register_vault(111, 222);
  // Suspend via insolvency proof
  let proof = array![1, 2, 3];
  registry.submit_proof_of_insolvency(proof.span());
  stop_cheat_caller_address(addr);

  assert(!registry.is_vault_active(0), 'suspended');

  // Deposit reactivates
  start_cheat_caller_address(addr, VAULT_OP1());
  registry.deposit_collateral(1000);
  stop_cheat_caller_address(addr);

  assert(registry.is_vault_active(0), 'reactivated');
}
