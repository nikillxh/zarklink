// wZEC Token - Wrapped ZEC on Starknet
// ERC20-compatible token representing locked ZEC on Zcash

use starknet::ContractAddress;

#[starknet::interface]
pub trait IwZEC<TContractState> {
    // ERC20 Standard
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
        amount: u256
    ) -> bool;
    fn approve(ref self: TContractState, spender: ContractAddress, amount: u256) -> bool;

    // ZCLAIM-specific functions
    fn mint(ref self: TContractState, to: ContractAddress, amount: u256);
    fn burn(ref self: TContractState, from: ContractAddress, amount: u256);
    fn bridge_address(self: @TContractState) -> ContractAddress;
    fn set_bridge(ref self: TContractState, bridge: ContractAddress);
}

#[starknet::contract]
pub mod wZEC {
    use starknet::{ContractAddress, get_caller_address};
    use starknet::storage::{
        StoragePointerReadAccess, StoragePointerWriteAccess,
        Map, StoragePathEntry
    };
    use core::num::traits::Zero;

    #[storage]
    struct Storage {
        // ERC20 storage
        name: ByteArray,
        symbol: ByteArray,
        decimals: u8,
        total_supply: u256,
        balances: Map<ContractAddress, u256>,
        allowances: Map<(ContractAddress, ContractAddress), u256>,
        // ZCLAIM-specific
        bridge: ContractAddress,
        owner: ContractAddress,
    }

    #[event]
    #[derive(Drop, starknet::Event)]
    pub enum Event {
        Transfer: Transfer,
        Approval: Approval,
        BridgeUpdated: BridgeUpdated,
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
    pub struct BridgeUpdated {
        pub old_bridge: ContractAddress,
        pub new_bridge: ContractAddress,
    }

    pub mod Errors {
        pub const INSUFFICIENT_BALANCE: felt252 = 'wZEC: insufficient balance';
        pub const INSUFFICIENT_ALLOWANCE: felt252 = 'wZEC: insufficient allowance';
        pub const TRANSFER_TO_ZERO: felt252 = 'wZEC: transfer to zero address';
        pub const APPROVE_TO_ZERO: felt252 = 'wZEC: approve to zero address';
        pub const NOT_BRIDGE: felt252 = 'wZEC: caller is not bridge';
        pub const NOT_OWNER: felt252 = 'wZEC: caller is not owner';
        pub const ZERO_ADDRESS: felt252 = 'wZEC: zero address';
    }

    #[constructor]
    fn constructor(ref self: ContractState, owner: ContractAddress) {
        self.name.write("Wrapped ZEC");
        self.symbol.write("wZEC");
        self.decimals.write(8); // ZEC has 8 decimals (like Bitcoin)
        self.owner.write(owner);
    }

    #[abi(embed_v0)]
    impl wZECImpl of super::IwZEC<ContractState> {
        fn name(self: @ContractState) -> ByteArray {
            self.name.read()
        }

        fn symbol(self: @ContractState) -> ByteArray {
            self.symbol.read()
        }

        fn decimals(self: @ContractState) -> u8 {
            self.decimals.read()
        }

        fn total_supply(self: @ContractState) -> u256 {
            self.total_supply.read()
        }

        fn balance_of(self: @ContractState, account: ContractAddress) -> u256 {
            self.balances.entry(account).read()
        }

        fn allowance(
            self: @ContractState,
            owner: ContractAddress,
            spender: ContractAddress
        ) -> u256 {
            self.allowances.entry((owner, spender)).read()
        }

        fn transfer(ref self: ContractState, recipient: ContractAddress, amount: u256) -> bool {
            let sender = get_caller_address();
            self._transfer(sender, recipient, amount);
            true
        }

        fn transfer_from(
            ref self: ContractState,
            sender: ContractAddress,
            recipient: ContractAddress,
            amount: u256
        ) -> bool {
            let caller = get_caller_address();
            let current_allowance = self.allowances.entry((sender, caller)).read();
            assert(current_allowance >= amount, Errors::INSUFFICIENT_ALLOWANCE);
            
            self.allowances.entry((sender, caller)).write(current_allowance - amount);
            self._transfer(sender, recipient, amount);
            true
        }

        fn approve(ref self: ContractState, spender: ContractAddress, amount: u256) -> bool {
            let owner = get_caller_address();
            self._approve(owner, spender, amount);
            true
        }

        // ZCLAIM-specific: Mint new wZEC (only callable by bridge)
        fn mint(ref self: ContractState, to: ContractAddress, amount: u256) {
            self._only_bridge();
            assert(!to.is_zero(), Errors::ZERO_ADDRESS);

            let current_supply = self.total_supply.read();
            self.total_supply.write(current_supply + amount);

            let current_balance = self.balances.entry(to).read();
            self.balances.entry(to).write(current_balance + amount);

            self.emit(Transfer { from: Zero::zero(), to, value: amount });
        }

        // ZCLAIM-specific: Burn wZEC (only callable by bridge)
        fn burn(ref self: ContractState, from: ContractAddress, amount: u256) {
            self._only_bridge();
            
            let current_balance = self.balances.entry(from).read();
            assert(current_balance >= amount, Errors::INSUFFICIENT_BALANCE);

            self.balances.entry(from).write(current_balance - amount);
            
            let current_supply = self.total_supply.read();
            self.total_supply.write(current_supply - amount);

            self.emit(Transfer { from, to: Zero::zero(), value: amount });
        }

        fn bridge_address(self: @ContractState) -> ContractAddress {
            self.bridge.read()
        }

        fn set_bridge(ref self: ContractState, bridge: ContractAddress) {
            self._only_owner();
            assert(!bridge.is_zero(), Errors::ZERO_ADDRESS);

            let old_bridge = self.bridge.read();
            self.bridge.write(bridge);

            self.emit(BridgeUpdated { old_bridge, new_bridge: bridge });
        }
    }

    #[generate_trait]
    impl InternalImpl of InternalTrait {
        fn _transfer(
            ref self: ContractState,
            sender: ContractAddress,
            recipient: ContractAddress,
            amount: u256
        ) {
            assert(!recipient.is_zero(), Errors::TRANSFER_TO_ZERO);

            let sender_balance = self.balances.entry(sender).read();
            assert(sender_balance >= amount, Errors::INSUFFICIENT_BALANCE);

            self.balances.entry(sender).write(sender_balance - amount);
            
            let recipient_balance = self.balances.entry(recipient).read();
            self.balances.entry(recipient).write(recipient_balance + amount);

            self.emit(Transfer { from: sender, to: recipient, value: amount });
        }

        fn _approve(
            ref self: ContractState,
            owner: ContractAddress,
            spender: ContractAddress,
            amount: u256
        ) {
            assert(!spender.is_zero(), Errors::APPROVE_TO_ZERO);
            
            self.allowances.entry((owner, spender)).write(amount);
            
            self.emit(Approval { owner, spender, value: amount });
        }

        fn _only_bridge(self: @ContractState) {
            let caller = get_caller_address();
            let bridge = self.bridge.read();
            assert(caller == bridge, Errors::NOT_BRIDGE);
        }

        fn _only_owner(self: @ContractState) {
            let caller = get_caller_address();
            let owner = self.owner.read();
            assert(caller == owner, Errors::NOT_OWNER);
        }
    }
}
