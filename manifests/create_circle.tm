use template_TEMPLATE_HEX as TariArisan;

fn fee_main() {
    let account = var!["fee_account"];
    account.pay_fee(1000000);
}

fn main() {
    let circle = TariArisan::new(
        [public_key!("PK1"), public_key!("PK2"), public_key!("PK3"), public_key!("PK4")],
        [address!("ACCT1"), address!("ACCT2"), address!("ACCT3"), address!("ACCT4")],
        amount!(100000),
        4u32,
        1u64
    );
}
