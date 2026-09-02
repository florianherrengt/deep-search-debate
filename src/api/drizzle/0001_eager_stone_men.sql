CREATE TABLE `openai_codex_connections` (
	`user_id` text PRIMARY KEY NOT NULL,
	`connection_id` text NOT NULL,
	`credentials_ciphertext` blob NOT NULL,
	`credentials_nonce` blob NOT NULL,
	`credentials_authentication_tag` blob NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "openai_codex_connections_connection_id_check" CHECK(length(trim("openai_codex_connections"."connection_id")) > 0),
	CONSTRAINT "openai_codex_connections_ciphertext_check" CHECK(typeof("openai_codex_connections"."credentials_ciphertext") = 'blob' and length("openai_codex_connections"."credentials_ciphertext") > 0),
	CONSTRAINT "openai_codex_connections_nonce_check" CHECK(typeof("openai_codex_connections"."credentials_nonce") = 'blob' and length("openai_codex_connections"."credentials_nonce") = 12),
	CONSTRAINT "openai_codex_connections_authentication_tag_check" CHECK(typeof("openai_codex_connections"."credentials_authentication_tag") = 'blob' and length("openai_codex_connections"."credentials_authentication_tag") = 16)
);
