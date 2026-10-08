CREATE TABLE `deepseek_api_keys` (
	`user_id` text PRIMARY KEY NOT NULL,
	`api_key_ciphertext` blob NOT NULL,
	`api_key_nonce` blob NOT NULL,
	`api_key_authentication_tag` blob NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "deepseek_api_keys_ciphertext_check" CHECK(typeof("deepseek_api_keys"."api_key_ciphertext") = 'blob' and length("deepseek_api_keys"."api_key_ciphertext") > 0),
	CONSTRAINT "deepseek_api_keys_nonce_check" CHECK(typeof("deepseek_api_keys"."api_key_nonce") = 'blob' and length("deepseek_api_keys"."api_key_nonce") = 12),
	CONSTRAINT "deepseek_api_keys_authentication_tag_check" CHECK(typeof("deepseek_api_keys"."api_key_authentication_tag") = 'blob' and length("deepseek_api_keys"."api_key_authentication_tag") = 16)
);
