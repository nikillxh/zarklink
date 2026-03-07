use starknet::ContractAddress;
use snforge_std::{
  declare, ContractClassTrait, DeclareResultTrait,
  start_cheat_caller_address, stop_cheat_caller_address,
  start_cheat_block_timestamp, stop_cheat_block_timestamp,
};
use zarklink::oracle::{IOracleDispatcher, IOracleDispatcherTrait};

fn OWNER() -> ContractAddress {
  1.try_into().unwrap()
}

fn PROVIDER1() -> ContractAddress {
  2.try_into().unwrap()
}

fn PROVIDER2() -> ContractAddress {
  3.try_into().unwrap()
}

fn RANDOM_USER() -> ContractAddress {
  4.try_into().unwrap()
}

const INITIAL_RATE: u256 = 1_000_000_000_000_000_000; // 1e18
const MAX_DEVIATION_BPS: u256 = 500; // 5%

fn deploy_oracle() -> (ContractAddress, IOracleDispatcher) {
  let contract = declare("Oracle").unwrap().contract_class();
  let mut calldata: Array<felt252> = array![];
  // constructor(owner, initial_rate, max_deviation_bps)
  calldata.append(OWNER().into());
  calldata.append(INITIAL_RATE.low.into());
  calldata.append(INITIAL_RATE.high.into());
  calldata.append(MAX_DEVIATION_BPS.low.into());
  calldata.append(MAX_DEVIATION_BPS.high.into());
  let (addr, _) = contract.deploy(@calldata).unwrap();
  (addr, IOracleDispatcher { contract_address: addr })
}

// -- Basic tests --

#[test]
fn test_initial_rate() {
  let (_, oracle) = deploy_oracle();
  assert(oracle.get_rate() == INITIAL_RATE, 'wrong initial rate');
}

#[test]
fn test_rate_valid_initially() {
  let (_, oracle) = deploy_oracle();
  assert(oracle.is_rate_valid(), 'rate should be valid');
}

// -- Rate update tests --

#[test]
fn test_owner_can_update_rate() {
  let (addr, oracle) = deploy_oracle();
  let new_rate: u256 = 1_010_000_000_000_000_000; // +1% (within 5% deviation)

  start_cheat_caller_address(addr, OWNER());
  oracle.update_rate(new_rate);
  stop_cheat_caller_address(addr);

  assert(oracle.get_rate() == new_rate, 'rate not updated');
}

#[test]
fn test_authorized_provider_can_update() {
  let (addr, oracle) = deploy_oracle();

  // Add PROVIDER1 as feed provider
  start_cheat_caller_address(addr, OWNER());
  oracle.add_feed_provider(PROVIDER1());
  stop_cheat_caller_address(addr);

  // Provider1 updates rate
  let new_rate: u256 = 1_020_000_000_000_000_000; // +2%
  start_cheat_caller_address(addr, PROVIDER1());
  oracle.update_rate(new_rate);
  stop_cheat_caller_address(addr);

  assert(oracle.get_rate() == new_rate, 'rate not updated');
}

#[test]
#[should_panic]
fn test_unauthorized_update_fails() {
  let (addr, oracle) = deploy_oracle();
  start_cheat_caller_address(addr, RANDOM_USER());
  oracle.update_rate(1_010_000_000_000_000_000);
  stop_cheat_caller_address(addr);
}

// -- Circuit breaker tests --

#[test]
fn test_circuit_breaker_on_large_deviation() {
  let (addr, oracle) = deploy_oracle();
  // Attempt +10% change (exceeds 5% max deviation)
  let bad_rate: u256 = 1_100_000_000_000_000_000;

  start_cheat_caller_address(addr, OWNER());
  oracle.update_rate(bad_rate);
  stop_cheat_caller_address(addr);

  // Rate should NOT have changed (circuit breaker returned early)
  assert(oracle.get_rate() == INITIAL_RATE, 'rate should not change');
  // Circuit breaker should be active -> rate not valid
  assert(!oracle.is_rate_valid(), 'should be invalid');
}

#[test]
fn test_rate_recovered_after_normal_update() {
  let (addr, oracle) = deploy_oracle();

  // Trigger circuit breaker
  start_cheat_caller_address(addr, OWNER());
  oracle.update_rate(1_100_000_000_000_000_000); // +10%, triggers breaker
  assert(!oracle.is_rate_valid(), 'should be invalid');

  // Normal update within tolerance resets circuit breaker
  oracle.update_rate(1_040_000_000_000_000_000); // +4%, within 5%
  stop_cheat_caller_address(addr);

  assert(oracle.is_rate_valid(), 'should be valid again');
}

// -- Feed provider management --

#[test]
fn test_add_and_remove_feed_provider() {
  let (addr, oracle) = deploy_oracle();

  start_cheat_caller_address(addr, OWNER());
  oracle.add_feed_provider(PROVIDER1());
  stop_cheat_caller_address(addr);

  // Provider1 can update
  start_cheat_caller_address(addr, PROVIDER1());
  oracle.update_rate(1_010_000_000_000_000_000);
  stop_cheat_caller_address(addr);
  assert(oracle.get_rate() == 1_010_000_000_000_000_000, 'provider1 updated');

  // Remove provider
  start_cheat_caller_address(addr, OWNER());
  oracle.remove_feed_provider(PROVIDER1());
  stop_cheat_caller_address(addr);
}

#[test]
#[should_panic]
fn test_non_owner_cannot_add_provider() {
  let (addr, oracle) = deploy_oracle();
  start_cheat_caller_address(addr, RANDOM_USER());
  oracle.add_feed_provider(PROVIDER1());
  stop_cheat_caller_address(addr);
}

// -- Max deviation management --

#[test]
fn test_set_max_deviation() {
  let (addr, oracle) = deploy_oracle();

  start_cheat_caller_address(addr, OWNER());
  oracle.set_max_deviation(1000); // 10%
  // Now +8% should succeed
  oracle.update_rate(1_080_000_000_000_000_000);
  stop_cheat_caller_address(addr);

  assert(oracle.get_rate() == 1_080_000_000_000_000_000, 'high dev ok');
}

#[test]
#[should_panic]
fn test_non_owner_cannot_set_deviation() {
  let (addr, oracle) = deploy_oracle();
  start_cheat_caller_address(addr, RANDOM_USER());
  oracle.set_max_deviation(1000);
  stop_cheat_caller_address(addr);
}

// -- TWAP test --

#[test]
fn test_twap_returns_rate_with_no_history() {
  let (_, oracle) = deploy_oracle();
  // Before any updates, TWAP falls back to current_rate
  assert(oracle.get_twap() == INITIAL_RATE, 'twap = initial');
}

// -- Staleness test --

#[test]
fn test_staleness_after_long_time() {
  let (addr, oracle) = deploy_oracle();
  // Simulate time passing beyond MAX_STALENESS (7200s)
  start_cheat_block_timestamp(addr, 10000);
  assert(!oracle.is_rate_valid(), 'should be stale');
  stop_cheat_block_timestamp(addr);
}

// -- Zero rate rejected --

#[test]
#[should_panic]
fn test_zero_rate_rejected() {
  let (addr, oracle) = deploy_oracle();
  start_cheat_caller_address(addr, OWNER());
  oracle.update_rate(0);
  stop_cheat_caller_address(addr);
}
