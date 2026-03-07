use starknet::ContractAddress;
use snforge_std::{
  declare, ContractClassTrait, DeclareResultTrait,
  start_cheat_caller_address, stop_cheat_caller_address
};
use zarklink::wzec_token::{IWzecTokenDispatcher, IWzecTokenDispatcherTrait};

fn OWNER() -> ContractAddress {
  1.try_into().unwrap()
}

fn BRIDGE() -> ContractAddress {
  2.try_into().unwrap()
}

fn USER1() -> ContractAddress {
  3.try_into().unwrap()
}

fn USER2() -> ContractAddress {
  4.try_into().unwrap()
}

fn NEW_BRIDGE() -> ContractAddress {
  5.try_into().unwrap()
}

fn deploy_wzec() -> (ContractAddress, IWzecTokenDispatcher) {
  let contract = declare("WzecToken").unwrap().contract_class();
  let mut calldata: Array<felt252> = array![];
  calldata.append(OWNER().into());
  calldata.append(BRIDGE().into());
  let (addr, _) = contract.deploy(@calldata).unwrap();
  (addr, IWzecTokenDispatcher { contract_address: addr })
}

// Metadata tests

#[test]
fn test_name() {
  let (_, wzec) = deploy_wzec();
  assert(wzec.name() == "Wrapped Zcash", 'wrong name');
}

#[test]
fn test_symbol() {
  let (_, wzec) = deploy_wzec();
  assert(wzec.symbol() == "wZEC", 'wrong symbol');
}

#[test]
fn test_decimals() {
  let (_, wzec) = deploy_wzec();
  assert(wzec.decimals() == 8, 'wrong decimals');
}

#[test]
fn test_initial_supply_is_zero() {
  let (_, wzec) = deploy_wzec();
  assert(wzec.total_supply() == 0, 'supply should be 0');
}

// Mint tests

#[test]
fn test_mint_by_bridge() {
  let (addr, wzec) = deploy_wzec();
  start_cheat_caller_address(addr, BRIDGE());
  wzec.mint(USER1(), 100_000_000);
  stop_cheat_caller_address(addr);

  assert(wzec.balance_of(USER1()) == 100_000_000, 'balance wrong');
  assert(wzec.total_supply() == 100_000_000, 'supply wrong');
}

#[test]
#[should_panic]
fn test_mint_by_non_bridge_fails() {
  let (addr, wzec) = deploy_wzec();
  start_cheat_caller_address(addr, USER1());
  wzec.mint(USER1(), 100_000_000);
  stop_cheat_caller_address(addr);
}

// Burn tests

#[test]
fn test_burn_by_bridge() {
  let (addr, wzec) = deploy_wzec();
  start_cheat_caller_address(addr, BRIDGE());
  wzec.mint(USER1(), 100_000_000);
  wzec.burn(USER1(), 50_000_000);
  stop_cheat_caller_address(addr);

  assert(wzec.balance_of(USER1()) == 50_000_000, 'balance wrong');
  assert(wzec.total_supply() == 50_000_000, 'supply wrong');
}

#[test]
#[should_panic]
fn test_burn_by_non_bridge_fails() {
  let (addr, wzec) = deploy_wzec();
  start_cheat_caller_address(addr, BRIDGE());
  wzec.mint(USER1(), 100_000_000);
  stop_cheat_caller_address(addr);

  start_cheat_caller_address(addr, USER1());
  wzec.burn(USER1(), 50_000_000);
  stop_cheat_caller_address(addr);
}

#[test]
#[should_panic]
fn test_burn_more_than_balance_fails() {
  let (addr, wzec) = deploy_wzec();
  start_cheat_caller_address(addr, BRIDGE());
  wzec.mint(USER1(), 100);
  wzec.burn(USER1(), 200);
  stop_cheat_caller_address(addr);
}

// Transfer tests

#[test]
fn test_transfer() {
  let (addr, wzec) = deploy_wzec();
  start_cheat_caller_address(addr, BRIDGE());
  wzec.mint(USER1(), 1000);
  stop_cheat_caller_address(addr);

  start_cheat_caller_address(addr, USER1());
  let ok = wzec.transfer(USER2(), 400);
  stop_cheat_caller_address(addr);

  assert(ok, 'transfer should return true');
  assert(wzec.balance_of(USER1()) == 600, 'sender balance');
  assert(wzec.balance_of(USER2()) == 400, 'receiver balance');
}

#[test]
#[should_panic]
fn test_transfer_insufficient_balance_fails() {
  let (addr, wzec) = deploy_wzec();
  start_cheat_caller_address(addr, BRIDGE());
  wzec.mint(USER1(), 100);
  stop_cheat_caller_address(addr);

  start_cheat_caller_address(addr, USER1());
  wzec.transfer(USER2(), 200);
  stop_cheat_caller_address(addr);
}

// Approve and TransferFrom tests

#[test]
fn test_approve_and_transfer_from() {
  let (addr, wzec) = deploy_wzec();
  start_cheat_caller_address(addr, BRIDGE());
  wzec.mint(USER1(), 1000);
  stop_cheat_caller_address(addr);

  start_cheat_caller_address(addr, USER1());
  let ok = wzec.approve(USER2(), 500);
  assert(ok, 'approve should return true');
  stop_cheat_caller_address(addr);

  assert(wzec.allowance(USER1(), USER2()) == 500, 'allowance wrong');

  start_cheat_caller_address(addr, USER2());
  let ok2 = wzec.transfer_from(USER1(), USER2(), 300);
  assert(ok2, 'transferFrom ok');
  stop_cheat_caller_address(addr);

  assert(wzec.balance_of(USER1()) == 700, 'sender balance');
  assert(wzec.balance_of(USER2()) == 300, 'receiver balance');
  assert(wzec.allowance(USER1(), USER2()) == 200, 'remaining allowance');
}

#[test]
#[should_panic]
fn test_transfer_from_exceeds_allowance_fails() {
  let (addr, wzec) = deploy_wzec();
  start_cheat_caller_address(addr, BRIDGE());
  wzec.mint(USER1(), 1000);
  stop_cheat_caller_address(addr);

  start_cheat_caller_address(addr, USER1());
  wzec.approve(USER2(), 100);
  stop_cheat_caller_address(addr);

  start_cheat_caller_address(addr, USER2());
  wzec.transfer_from(USER1(), USER2(), 200);
  stop_cheat_caller_address(addr);
}

// set_bridge tests

#[test]
fn test_set_bridge_by_owner() {
  let (addr, wzec) = deploy_wzec();

  start_cheat_caller_address(addr, OWNER());
  wzec.set_bridge(NEW_BRIDGE());
  stop_cheat_caller_address(addr);

  start_cheat_caller_address(addr, NEW_BRIDGE());
  wzec.mint(USER1(), 100);
  stop_cheat_caller_address(addr);

  assert(wzec.balance_of(USER1()) == 100, 'mint from new bridge');
}

#[test]
#[should_panic]
fn test_set_bridge_by_non_owner_fails() {
  let (addr, wzec) = deploy_wzec();
  start_cheat_caller_address(addr, USER1());
  wzec.set_bridge(USER1());
  stop_cheat_caller_address(addr);
}

// Multiple mint and burn

#[test]
fn test_multiple_mints_accumulate() {
  let (addr, wzec) = deploy_wzec();
  start_cheat_caller_address(addr, BRIDGE());
  wzec.mint(USER1(), 100);
  wzec.mint(USER1(), 200);
  wzec.mint(USER2(), 300);
  stop_cheat_caller_address(addr);

  assert(wzec.balance_of(USER1()) == 300, 'user1 balance');
  assert(wzec.balance_of(USER2()) == 300, 'user2 balance');
  assert(wzec.total_supply() == 600, 'total supply');
}
