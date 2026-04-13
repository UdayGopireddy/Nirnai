use aws_sdk_dynamodb::Client;

pub async fn new_client() -> Client {
    let config = aws_config::load_from_env().await;
    Client::new(&config)
}
