// ============================================================================
// Zarklink — Exchange Rate Oracle Contract
// ============================================================================
// Provides ZEC/STRK exchange rate for collateral calculations.
// Uses TWAP for manipulation resistance with circuit breaker.

use starknet::ContractAddress;

#[starknet::interface]
pub trait IOracle<TContractState> {
  fn get_rate(self: @TContractState) -> u256;
  fn get_twap(self: @TContractState) -> u256;
  fn update_rate(ref self: TContractState, new_rate: u256);
  fn get_last_update(self: @TContractState) -> u64;
  fn is_rate_valid(self: @TContractState) -> bool;
  fn set_max_deviation(ref self: TContractState, max_deviation_bps: u256);
  fn add_feed_provider(ref self: TContractState, provider: ContractAddress);
  fn remove_feed_provider(ref self: TContractState, provider: ContractAddress);
}

#[starknet::contract]
pub mod Oracle {
  use super::IOracle;
  use starknet::{ContractAddress, get_caller_address, get_block_timestamp};
  use starknet::storage::{
    Map, StorageMapReadAccess, StorageMapWriteAccess,
    StoragePointerReadAccess, StoragePointerWriteAccess,
  };

  const RATE_DECIMALS: u256 = 1_000_000_000_000_000_000; // 18 decimals
  const TWAP_WINDOW: u64 = 3600; // 1 hour in seconds
  const MAX_STALENESS: u64 = 7200; // 2 hours
  const MAX_HISTORY: u32 = 24;

  #[storage]
  struct Storage {
    owner: ContractAddress,
    current_rate: u256,
    last_update: u64,
    max_deviation_bps: u256,
    feed_providers: Map<ContractAddress, bool>,
    rate_history: Map<u32, u256>,
    timestamp_history: Map<u32, u64>,
    history_index: u32,
    history_count: u32,
    circuit_breaker_active: bool,
  }

  #[event]
  #[derive(Drop, starknet::Event)]
  pub enum Event {
    RateUpdated: RateUpdated,
    CircuitBreakerTriggered: CircuitBreakerTriggered,
    FeedProviderChanged: FeedProviderChanged,
  }

  #[derive(Drop, starknet::Event)]
  pub struct RateUpdated {
    pub new_rate: u256,
    pub provider: ContractAddress,
    pub timestamp: u64,
  }

  #[derive(Drop, starknet::Event)]
  pub struct CircuitBreakerTriggered {
    pub old_rate: u256,
    pub attempted_rate: u256,
  }

  #[derive(Drop, starknet::Event)]
  pub struct FeedProviderChanged {
    pub provider: ContractAddress,
    pub authorized: bool,
  }

  #[constructor]
  fn constructor(
    ref self: ContractState,
    owner: ContractAddress,
    initial_rate: u256,
    max_deviation_bps: u256,
  ) {
    self.owner.write(owner);
    self.current_rate.write(initial_rate);
    self.last_update.write(get_block_timestamp());
    self.max_deviation_bps.write(max_deviation_bps);
    self.history_index.write(0);
    self.history_count.write(0);
    self.circuit_breaker_active.write(false);
    self.feed_providers.write(owner, true);
  }

  #[abi(embed_v0)]
  impl OracleImpl of IOracle<ContractState> {
    fn get_rate(self: @ContractState) -> u256 {
      self.current_rate.read()
    }

    fn get_twap(self: @ContractState) -> u256 {
      let count = self.history_count.read();
      if count == 0 {
        return self.current_rate.read();
      }

      let now = get_block_timestamp();
      let window_start = if now > TWAP_WINDOW {
        now - TWAP_WINDOW
      } else {
        0
      };

      let mut sum: u256 = 0;
      let mut weight_sum: u256 = 0;
      let mut i: u32 = 0;

      while i < count {
        let ts = self.timestamp_history.read(i);
        if ts >= window_start {
          let rate = self.rate_history.read(i);
          let weight: u256 = (ts - window_start).into();
          sum += rate * weight;
          weight_sum += weight;
        }
        i += 1;
      };

      if weight_sum == 0 {
        self.current_rate.read()
      } else {
        sum / weight_sum
      }
    }

    fn update_rate(ref self: ContractState, new_rate: u256) {
      let caller = get_caller_address();
      assert(self.feed_providers.read(caller), 'Not authorized provider');
      assert(new_rate > 0, 'Rate must be positive');

      let current = self.current_rate.read();
      let max_dev = self.max_deviation_bps.read();

      // Circuit breaker: reject if deviation too large
      if current > 0 {
        let deviation = if new_rate > current {
          ((new_rate - current) * 10000) / current
        } else {
          ((current - new_rate) * 10000) / current
        };

        if deviation > max_dev {
          self.circuit_breaker_active.write(true);
          self.emit(CircuitBreakerTriggered {
            old_rate: current,
            attempted_rate: new_rate,
          });
          return;
        }
      }

      let now = get_block_timestamp();

      // Store in history ring buffer
      let idx = self.history_index.read();
      self.rate_history.write(idx, new_rate);
      self.timestamp_history.write(idx, now);

      let next_idx = (idx + 1) % MAX_HISTORY;
      self.history_index.write(next_idx);

      let count = self.history_count.read();
      if count < MAX_HISTORY {
        self.history_count.write(count + 1);
      }

      self.current_rate.write(new_rate);
      self.last_update.write(now);
      self.circuit_breaker_active.write(false);

      self.emit(RateUpdated {
        new_rate,
        provider: caller,
        timestamp: now,
      });
    }

    fn get_last_update(self: @ContractState) -> u64 {
      self.last_update.read()
    }

    fn is_rate_valid(self: @ContractState) -> bool {
      let last = self.last_update.read();
      let now = get_block_timestamp();
      let is_fresh = (now - last) < MAX_STALENESS;
      let is_not_broken = !self.circuit_breaker_active.read();
      is_fresh && is_not_broken
    }

    fn set_max_deviation(ref self: ContractState, max_deviation_bps: u256) {
      let caller = get_caller_address();
      assert(caller == self.owner.read(), 'Only owner');
      self.max_deviation_bps.write(max_deviation_bps);
    }

    fn add_feed_provider(ref self: ContractState, provider: ContractAddress) {
      let caller = get_caller_address();
      assert(caller == self.owner.read(), 'Only owner');
      self.feed_providers.write(provider, true);
      self.emit(FeedProviderChanged { provider, authorized: true });
    }

    fn remove_feed_provider(ref self: ContractState, provider: ContractAddress) {
      let caller = get_caller_address();
      assert(caller == self.owner.read(), 'Only owner');
      self.feed_providers.write(provider, false);
      self.emit(FeedProviderChanged { provider, authorized: false });
    }
  }
}
