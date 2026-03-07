// ============================================================================
// Zarklink — wZEC Token Contract (ERC-20 / SNIP-2)
// ============================================================================
// Wrapped ZEC token on Starknet. Mintable/burnable only by the
// bridge protocol contract.

use starknet::ContractAddress;

#[starknet::interface]
pub trait IWzecToken<TContractState> {
  // ERC-20 standard
  fn name(self: @TContractState) -> ByteArray;
  fn symbol(self: @TContractState) -> ByteArray;
  fn decimals(self: @TContractState) -> u8;
  fn total_supply(self: @TContractState) -> u256;
  fn balance_of(self: @TContractState, account: ContractAddress) -> u256;
  fn allowance(self: @TContractState, owner: ContractAddress, spender: ContractAddress) -> u256;
  fn transfer(ref self: TContractState, recipient: ContractAddress, amount: u256) -> bool;
  fn transfer_from(
    ref self: TContractState,
    sender: ContractAddress,
    recipient: ContractAddress,
    amount: u256,
  ) -> bool;
  fn approve(ref self: TContractState, spender: ContractAddress, amount: u256) -> bool;

  // Bridge-specific
  fn mint(ref self: TContractState, to: ContractAddress, amount: u256);
  fn burn(ref self: TContractState, from: ContractAddress, amount: u256);
  fn set_bridge(ref self: TContractState, bridge: ContractAddress);
}

#[starknet::contract]
pub mod WzecToken {
  use super::IWzecToken;
  use starknet::{ContractAddress, get_caller_address};
  use starknet::storage::{
    Map, StorageMapReadAccess, StorageMapWriteAccess,
    StoragePointerReadAccess, StoragePointerWriteAccess,
  };

  #[storage]
  struct Storage {
    owner: ContractAddress,
    bridge: ContractAddress,
    total_supply: u256,
    balances: Map<ContractAddress, u256>,
    allowances: Map<(ContractAddress, ContractAddress), u256>,
  }

  #[event]
  #[derive(Drop, starknet::Event)]
  pub enum Event {
    Transfer: Transfer,
    Approval: Approval,
    Mint: Mint,
    Burn: Burn,
  }

  #[derive(Drop, starknet::Event)]
  pub struct Transfer {
    #[key]
    pub from: ContractAddress,
    #[key]
    pub to: ContractAddress,
    pub value: u256,
  }

  #[derive(Drop, starknet::Event)]
  pub struct Approval {
    #[key]
    pub owner: ContractAddress,
    #[key]
    pub spender: ContractAddress,
    pub value: u256,
  }

  #[derive(Drop, starknet::Event)]
  pub struct Mint {
    pub to: ContractAddress,
    pub amount: u256,
  }

  #[derive(Drop, starknet::Event)]
  pub struct Burn {
    pub from: ContractAddress,
    pub amount: u256,
  }

  #[constructor]
  fn constructor(
    ref self: ContractState,
    owner: ContractAddress,
    bridge: ContractAddress,
  ) {
    self.owner.write(owner);
    self.bridge.write(bridge);
    self.total_supply.write(0_u256);
  }

  #[abi(embed_v0)]
  impl WzecTokenImpl of IWzecToken<ContractState> {
    fn name(self: @ContractState) -> ByteArray {
      "Wrapped Zcash"
    }

    fn symbol(self: @ContractState) -> ByteArray {
      "wZEC"
    }

    fn decimals(self: @ContractState) -> u8 {
      8 // Zcash uses 8 decimal places (zatoshi)
    }

    fn total_supply(self: @ContractState) -> u256 {
      self.total_supply.read()
    }

    fn balance_of(self: @ContractState, account: ContractAddress) -> u256 {
      self.balances.read(account)
    }

    fn allowance(
      self: @ContractState,
      owner: ContractAddress,
      spender: ContractAddress,
    ) -> u256 {
      self.allowances.read((owner, spender))
    }

    fn transfer(
      ref self: ContractState,
      recipient: ContractAddress,
      amount: u256,
    ) -> bool {
      let caller = get_caller_address();
      self._transfer(caller, recipient, amount);
      true
    }

    fn transfer_from(
      ref self: ContractState,
      sender: ContractAddress,
      recipient: ContractAddress,
      amount: u256,
    ) -> bool {
      let caller = get_caller_address();
      let current_allowance = self.allowances.read((sender, caller));
      assert(current_allowance >= amount, 'Insufficient allowance');
      self.allowances.write((sender, caller), current_allowance - amount);
      self._transfer(sender, recipient, amount);
      true
    }

    fn approve(
      ref self: ContractState,
      spender: ContractAddress,
      amount: u256,
    ) -> bool {
      let caller = get_caller_address();
      self.allowances.write((caller, spender), amount);
      self.emit(Approval { owner: caller, spender, value: amount });
      true
    }

    fn mint(ref self: ContractState, to: ContractAddress, amount: u256) {
      let caller = get_caller_address();
      assert(caller == self.bridge.read(), 'Only bridge can mint');

      let supply = self.total_supply.read();
      self.total_supply.write(supply + amount);

      let balance = self.balances.read(to);
      self.balances.write(to, balance + amount);

      self.emit(Mint { to, amount });
      let zero_addr: ContractAddress = 0_felt252.try_into().unwrap();
      self.emit(Transfer {
        from: zero_addr,
        to,
        value: amount,
      });
    }

    fn burn(ref self: ContractState, from: ContractAddress, amount: u256) {
      let caller = get_caller_address();
      assert(caller == self.bridge.read(), 'Only bridge can burn');

      let balance = self.balances.read(from);
      assert(balance >= amount, 'Insufficient balance');
      self.balances.write(from, balance - amount);

      let supply = self.total_supply.read();
      self.total_supply.write(supply - amount);

      self.emit(Burn { from, amount });
      let zero_addr: ContractAddress = 0_felt252.try_into().unwrap();
      self.emit(Transfer {
        from,
        to: zero_addr,
        value: amount,
      });
    }

    fn set_bridge(ref self: ContractState, bridge: ContractAddress) {
      let caller = get_caller_address();
      assert(caller == self.owner.read(), 'Only owner');
      self.bridge.write(bridge);
    }
  }

  #[generate_trait]
  impl InternalImpl of InternalTrait {
    fn _transfer(
      ref self: ContractState,
      sender: ContractAddress,
      recipient: ContractAddress,
      amount: u256,
    ) {
      let sender_balance = self.balances.read(sender);
      assert(sender_balance >= amount, 'Insufficient balance');
      self.balances.write(sender, sender_balance - amount);

      let recipient_balance = self.balances.read(recipient);
      self.balances.write(recipient, recipient_balance + amount);

      self.emit(Transfer { from: sender, to: recipient, value: amount });
    }
  }
}
