fn fee_main() {
    let account = var!["fee_account"];
    account.pay_fee(1000000);
}

fn main() {
    let account = var!["fee_account"];
    let circle = var!["circle"];
    let payment = account.withdraw(TARI, 100000);
    circle.contribute(0u32, payment);
}
