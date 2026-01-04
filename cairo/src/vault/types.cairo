// Vault Types for ZCLAIM Protocol

use starknet::ContractAddress;

/// Vault information stored in registry
#[derive(Drop, Serde, starknet::Store)]
pub struct Vault {
    /// Vault's Starknet address
    pub address: ContractAddress,
    /// Vault's Zcash shielded payment address hash (d, pkd)
    pub zcash_address_hash: u256,
    /// Amount of collateral locked in STRK
    pub collateral: u256,
    /// Homomorphic commitment to ZEC obligations (hidden amount)
    pub balance_commitment: u256,
    /// Last exchange rate used in balance proof
    pub last_exchange_rate: u256,
    /// Whether vault accepts new lock requests
    pub accepts_issue: bool,
    /// Whether vault accepts redeem requests
    pub accepts_redeem: bool,
    /// Timestamp of registration
    pub registered_at: u64,
    /// Whether vault is active
    pub active: bool,
}

/// Vault registration parameters
#[derive(Drop, Serde)]
pub struct VaultRegistration {
    /// Zcash shielded payment address (diversifier d)
    pub zcash_diversifier: u256,
    /// Zcash payment key (pkd)
    pub zcash_pkd: u256,
    /// Initial collateral amount
    pub collateral: u256,
}

/// Balance proof submitted by vault
#[derive(Drop, Serde)]
pub struct BalanceProof {
    /// Commitment to current ZEC obligations
    pub balance_commitment: u256,
    /// Exchange rate used
    pub exchange_rate: u256,
    /// zk-SNARK proof data
    pub proof: Array<felt252>,
    /// Block height at which proof is valid
    pub valid_at_height: u64,
}

/// Collateral ratios and thresholds
pub mod collateral {
    /// Standard collateralization ratio (150% = 1.5x)
    /// Stored as fixed point with 2 decimals: 150 = 1.50
    pub const STANDARD_RATIO: u256 = 150;
    
    /// Minimum ratio before liquidation (112.5% = 1.125x)
    pub const MINIMUM_RATIO: u256 = 112;
    
    /// Liquidation penalty (10%)
    pub const LIQUIDATION_PENALTY: u256 = 10;
    
    /// Ratio denominator (for percentage calculation)
    pub const RATIO_DENOMINATOR: u256 = 100;
}

/// Maximum transaction value (in zatoshi = 10^-8 ZEC)
/// Powers of 2 for splitting strategy
pub mod tx_limits {
    /// Maximum value per transaction: 2^30 zatoshi ≈ 10.7 ZEC
    pub const VMAX: u64 = 1073741824; // 2^30
    
    /// Minimum value per transaction: 2^10 zatoshi ≈ 0.00001 ZEC
    pub const VMIN: u64 = 1024; // 2^10
}

/// Vault status enum
#[derive(Drop, Copy, Serde, starknet::Store, PartialEq, Default)]
pub enum VaultStatus {
    /// Vault is not registered
    #[default]
    Unregistered,
    /// Vault is active and accepting requests
    Active,
    /// Vault is suspended (not accepting new requests)
    Suspended,
    /// Vault is being liquidated
    Liquidating,
    /// Vault has been liquidated
    Liquidated,
}
