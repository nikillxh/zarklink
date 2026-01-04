// ZCLAIM Bridge - Main Library
// Privacy-preserving Zcash to Starknet bridge
//
// STATUS: All modules enabled - verify with `scarb build`

pub mod token {
    pub mod wzec;
}

pub mod relay {
    pub mod types;
    pub mod relay_system;
}

pub mod vault {
    pub mod types;
    pub mod registry;
}

pub mod bridge {
    pub mod zclaim;
    // Note: mint.cairo and burn.cairo are helper modules
    // They can be enabled if needed
    // pub mod mint;
    // pub mod burn;
}

pub mod crypto {
    pub mod blake2b;
    pub mod sha256;
    pub mod merkle;
    pub mod commitments;
    pub mod snark;
    pub mod encryption;
}
