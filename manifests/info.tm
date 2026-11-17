fn fee_main() {
    let account = var!["fee_account"];
    account.pay_fee(1000000);
}

fn main() {
    let circle = var!["circle"];
    let snapshot = circle.info();
}
