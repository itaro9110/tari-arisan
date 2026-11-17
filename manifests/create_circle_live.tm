use template_f230b6fbe6409c10c8f3d9dbf47a722a0b7ab956d32ed5b57a1fd35e9e8399a5 as TariArisan;

fn fee_main() {
    let account = var!["fee_account"];
    account.pay_fee(1000000);
}

fn main() {
    let circle = TariArisan::new(
        [public_key!("f8a944e550083d42c7ba8cdd747c01666bac0e5d3db99bc2ac74a751b7cda33b"), public_key!("9ca24e464e49ad51b515cbbfb69321ea7eecb736988924ef3f4615bdf7be4f3b"), public_key!("7a6acdd8d76becb91af06a2ea6347c155002cceea0a0931b73bf663327e51407"), public_key!("8419b64df3a444fe8b6cb82afab7fd935e5e402aa89e289fba3091c814fd2e2d")],
        [address!("component_6e3b63a7695c9e619dff68589c85bb8e41bab8b403bcace1d97d17caa57fcde8"), address!("component_2807f2401e2cc0788dd9fc746b2e050812e542f260107595d33dbb74fa5355d6"), address!("component_1afd0cea282f8c18c1aadbc0b8a80eade4d9b0d3f4a8ee13fe4bb803ec32c3e8"), address!("component_d96c86455aeff316cacf2ba511a512c4970136c6295575f131a6db15d963be73")],
        amount!(100000),
        4u32,
        1u64
    );
}
