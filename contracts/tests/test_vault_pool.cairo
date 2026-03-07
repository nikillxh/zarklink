use starknet::ContractAddress;
use snforge_std::{
  declare, ContractClassTrait, DeclareResultTrait,
  start_cheat_caller_address, stop_cheat_caller_address,
};
use zarklink::vault_pool::{IVaultPoolDispatcher, IVaultPoolDispatcherTrait};
use zarklink::vault_registry::{IVaultRegistryDispatcher, IVaultRegistryDispatcherTrait};

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

const COLLATERAL_RATIO: u256 = 15000;
const MAX_LOCK: u256 = 100_000_000_000;
const FEE_RATE: u256 = 50;

fn deploy_registry_and_pool() -> (
  ContractAddress, IVaultRegistryDispatcher,
  ContractAddress, IVaultPoolDispatcher
) {
  // Deploy registry
  let reg_class = declare("VaultRegistry").unwrap().contract_class();
  let mut reg_cd: Array<felt252> = array![];
  reg_cd.append(OWNER().into());
  reg_cd.append(COLLATERAL_TOKEN().into());
  reg_cd.append(COLLATERAL_RATIO.low.into());
  reg_cd.append(COLLATERAL_RATIO.high.into());
  reg_cd.append(MAX_LOCK.low.into());
  reg_cd.append(MAX_LOCK.high.into());
  reg_cd.append(FEE_RATE.low.into());
  reg_cd.append(FEE_RATE.high.into());
  let (reg_addr, _) = reg_class.deploy(@reg_cd).unwrap();
  let registry = IVaultRegistryDispatcher { contract_address: reg_addr };

  // Deploy pool
  let pool_class = declare("VaultPool").unwrap().contract_class();
  let mut pool_cd: Array<felt252> = array![];
  // constructor(owner, vault_registry, collateral_token)
  pool_cd.append(OWNER().into());
  pool_cd.append(reg_addr.into());
  pool_cd.append(COLLATERAL_TOKEN().into());
  let (pool_addr, _) = pool_class.deploy(@pool_cd).unwrap();
  let pool = IVaultPoolDispatcher { contract_address: pool_addr };

  (reg_addr, registry, pool_addr, pool)
}

// Helper: register a vault and deposit to make it active in pool
fn setup_vault_in_pool(
  reg_addr: ContractAddress,
  registry: IVaultRegistryDispatcher,
  pool_addr: ContractAddress,
  pool: IVaultPoolDispatcher,
  operator: ContractAddress,
  collateral: u256,
) {
  // Register vault in registry
  start_cheat_caller_address(reg_addr, operator);
  registry.register_vault(111, 222);
  registry.deposit_collateral(collateral);
  stop_cheat_caller_address(reg_addr);

  // Deposit into pool
  start_cheat_caller_address(pool_addr, operator);
  pool.deposit_collateral(collateral);
  stop_cheat_caller_address(pool_addr);
}

// -- Basic tests --

#[test]
fn test_initial_state() {
  let (_, _, _, pool) = deploy_registry_and_pool();
  assert(pool.get_total_deposited() == 0, 'no deposits');
  assert(pool.get_active_vault_count() == 0, 'no vaults');
  assert(pool.get_pool_capacity() == 0, 'no capacity');
}

// -- Deposit tests --

#[test]
fn test_deposit_collateral() {
  let (reg_addr, registry, pool_addr, pool) = deploy_registry_and_pool();
  setup_vault_in_pool(reg_addr, registry, pool_addr, pool, VAULT_OP1(), 1000);

  assert(pool.get_total_deposited() == 1000, 'total 1000');
  assert(pool.get_active_vault_count() == 1, 'count 1');
  assert(pool.get_vault_pool_share(0) == 1000, 'share 1000');
}

// -- Withdraw tests --

#[test]
fn test_withdraw_collateral() {
  let (reg_addr, registry, pool_addr, pool) = deploy_registry_and_pool();
  setup_vault_in_pool(reg_addr, registry, pool_addr, pool, VAULT_OP1(), 1000);

  start_cheat_caller_address(pool_addr, VAULT_OP1());
  pool.withdraw_collateral(400);
  stop_cheat_caller_address(pool_addr);

  assert(pool.get_total_deposited() == 600, 'total 600');
  assert(pool.get_vault_pool_share(0) == 600, 'share 600');
}

#[test]
fn test_withdraw_all_removes_from_pool() {
  let (reg_addr, registry, pool_addr, pool) = deploy_registry_and_pool();
  setup_vault_in_pool(reg_addr, registry, pool_addr, pool, VAULT_OP1(), 1000);

  start_cheat_caller_address(pool_addr, VAULT_OP1());
  pool.withdraw_collateral(1000);
  stop_cheat_caller_address(pool_addr);

  assert(pool.get_active_vault_count() == 0, 'removed from pool');
  assert(pool.get_total_deposited() == 0, 'total 0');
}

// -- Assignment tests --

#[test]
fn test_assign_request() {
  let (reg_addr, registry, pool_addr, pool) = deploy_registry_and_pool();
  setup_vault_in_pool(reg_addr, registry, pool_addr, pool, VAULT_OP1(), 1000);

  // Assign a request (anyone can call)
  let vault_id = pool.assign_request(42);
  assert(vault_id == 0, 'assigned vault 0');
}

#[test]
#[should_panic]
fn test_assign_with_no_vaults_fails() {
  let (_, _, _, pool) = deploy_registry_and_pool();
  pool.assign_request(42);
}

// -- Encumber tests --

#[test]
fn test_encumber_and_release() {
  let (reg_addr, registry, pool_addr, pool) = deploy_registry_and_pool();
  setup_vault_in_pool(reg_addr, registry, pool_addr, pool, VAULT_OP1(), 1000);

  // Set bridge protocol
  start_cheat_caller_address(pool_addr, OWNER());
  pool.set_bridge_protocol(BRIDGE());
  stop_cheat_caller_address(pool_addr);

  // Encumber
  start_cheat_caller_address(pool_addr, BRIDGE());
  pool.encumber(0, 300);
  stop_cheat_caller_address(pool_addr);

  assert(pool.get_vault_free_collateral(0) == 700, 'free 700');
  assert(pool.get_pool_capacity() == 700, 'capacity 700');

  // Release
  start_cheat_caller_address(pool_addr, BRIDGE());
  pool.release_encumbrance(0, 200);
  stop_cheat_caller_address(pool_addr);

  assert(pool.get_vault_free_collateral(0) == 900, 'free 900');
}

#[test]
#[should_panic]
fn test_encumber_by_non_bridge_fails() {
  let (reg_addr, registry, pool_addr, pool) = deploy_registry_and_pool();
  setup_vault_in_pool(reg_addr, registry, pool_addr, pool, VAULT_OP1(), 1000);

  start_cheat_caller_address(pool_addr, RANDOM_USER());
  pool.encumber(0, 100);
  stop_cheat_caller_address(pool_addr);
}

#[test]
#[should_panic]
fn test_encumber_exceeds_capacity_fails() {
  let (reg_addr, registry, pool_addr, pool) = deploy_registry_and_pool();
  setup_vault_in_pool(reg_addr, registry, pool_addr, pool, VAULT_OP1(), 1000);

  start_cheat_caller_address(pool_addr, OWNER());
  pool.set_bridge_protocol(BRIDGE());
  stop_cheat_caller_address(pool_addr);

  start_cheat_caller_address(pool_addr, BRIDGE());
  pool.encumber(0, 1500); // more than deposited
  stop_cheat_caller_address(pool_addr);
}

#[test]
#[should_panic]
fn test_withdraw_encumbered_fails() {
  let (reg_addr, registry, pool_addr, pool) = deploy_registry_and_pool();
  setup_vault_in_pool(reg_addr, registry, pool_addr, pool, VAULT_OP1(), 1000);

  start_cheat_caller_address(pool_addr, OWNER());
  pool.set_bridge_protocol(BRIDGE());
  stop_cheat_caller_address(pool_addr);

  // Encumber 800
  start_cheat_caller_address(pool_addr, BRIDGE());
  pool.encumber(0, 800);
  stop_cheat_caller_address(pool_addr);

  // Try to withdraw 500 (only 200 free)
  start_cheat_caller_address(pool_addr, VAULT_OP1());
  pool.withdraw_collateral(500);
  stop_cheat_caller_address(pool_addr);
}

// -- set_bridge_protocol --

#[test]
fn test_set_bridge_protocol() {
  let (_, _, pool_addr, pool) = deploy_registry_and_pool();

  start_cheat_caller_address(pool_addr, OWNER());
  pool.set_bridge_protocol(BRIDGE());
  stop_cheat_caller_address(pool_addr);
}

#[test]
#[should_panic]
fn test_set_bridge_by_non_owner_fails() {
  let (_, _, pool_addr, pool) = deploy_registry_and_pool();
  start_cheat_caller_address(pool_addr, RANDOM_USER());
  pool.set_bridge_protocol(BRIDGE());
  stop_cheat_caller_address(pool_addr);
}
