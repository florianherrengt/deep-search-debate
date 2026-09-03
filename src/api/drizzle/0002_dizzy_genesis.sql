CREATE TABLE `llm_model_settings` (
	`user_id` text PRIMARY KEY NOT NULL,
	`small_provider` text NOT NULL,
	`small_model_id` text NOT NULL,
	`small_reasoning_effort` text NOT NULL,
	`big_provider` text NOT NULL,
	`big_model_id` text NOT NULL,
	`big_reasoning_effort` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "llm_model_settings_small_provider_check" CHECK("llm_model_settings"."small_provider" in ('deepseek', 'openai')),
	CONSTRAINT "llm_model_settings_small_model_id_check" CHECK(length(trim("llm_model_settings"."small_model_id")) > 0),
	CONSTRAINT "llm_model_settings_small_reasoning_effort_check" CHECK("llm_model_settings"."small_reasoning_effort" in ('none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra')),
	CONSTRAINT "llm_model_settings_big_provider_check" CHECK("llm_model_settings"."big_provider" in ('deepseek', 'openai')),
	CONSTRAINT "llm_model_settings_big_model_id_check" CHECK(length(trim("llm_model_settings"."big_model_id")) > 0),
	CONSTRAINT "llm_model_settings_big_reasoning_effort_check" CHECK("llm_model_settings"."big_reasoning_effort" in ('none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'))
);
