CREATE TABLE IF NOT EXISTS users (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  email VARCHAR(255) NOT NULL UNIQUE,
  display_name VARCHAR(120) NULL,
  status ENUM('active','blocked','deleted') NOT NULL DEFAULT 'active',
  password_hash VARCHAR(255) NULL,
  google_sub VARCHAR(255) NULL,
  is_admin TINYINT NOT NULL DEFAULT 0,
  register_ip VARCHAR(64) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS plans (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  code VARCHAR(64) NOT NULL UNIQUE,
  name VARCHAR(120) NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'CNY',
  price_cents INT UNSIGNED NOT NULL DEFAULT 0,
  billing_period ENUM('month','year','lifetime','one_time') NOT NULL DEFAULT 'month',
  upload_quota INT UNSIGNED NOT NULL DEFAULT 1,
  download_quota INT UNSIGNED NOT NULL DEFAULT 1,
  zip_quota INT UNSIGNED NOT NULL DEFAULT 1,
  max_items INT UNSIGNED NOT NULL DEFAULT 10,
  max_bytes BIGINT UNSIGNED NOT NULL DEFAULT 209715200,
  concurrency INT UNSIGNED NOT NULL DEFAULT 1,
  trial_days INT UNSIGNED NOT NULL DEFAULT 0,
  refund_policy VARCHAR(255) NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS entitlements (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  period_key VARCHAR(32) NOT NULL,
  upload_remaining INT NOT NULL DEFAULT 0,
  download_remaining INT NOT NULL DEFAULT 0,
  zip_remaining INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_entitlement(user_id,period_key),
  CONSTRAINT fk_ent_user FOREIGN KEY(user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS orders (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  order_no VARCHAR(64) NOT NULL UNIQUE,
  user_id BIGINT UNSIGNED NOT NULL,
  plan_id BIGINT UNSIGNED NOT NULL,
  provider VARCHAR(32) NOT NULL,
  status ENUM('pending','paid','failed','refunded','expired','partially_refunded') NOT NULL DEFAULT 'pending',
  amount_cents INT UNSIGNED NOT NULL,
  refunded_cents INT UNSIGNED NOT NULL DEFAULT 0,
  provider_trade_no VARCHAR(128) NULL,
  idempotency_key VARCHAR(64) NULL,
  paid_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_order_user FOREIGN KEY(user_id) REFERENCES users(id),
  CONSTRAINT fk_order_plan FOREIGN KEY(plan_id) REFERENCES plans(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS subscriptions (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  user_id BIGINT UNSIGNED NOT NULL,
  plan_id BIGINT UNSIGNED NOT NULL,
  order_no VARCHAR(64) NULL,
  source VARCHAR(32) NOT NULL DEFAULT 'purchase',
  status ENUM('active','expired','cancelled','pending') NOT NULL DEFAULT 'pending',
  start_at TIMESTAMP NULL,
  expires_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_sub_user FOREIGN KEY(user_id) REFERENCES users(id),
  CONSTRAINT fk_sub_plan FOREIGN KEY(plan_id) REFERENCES plans(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS payment_channels (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  provider VARCHAR(32) NOT NULL UNIQUE,
  enabled TINYINT(1) NOT NULL DEFAULT 0,
  config_json JSON NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS webhook_events (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  provider VARCHAR(32) NOT NULL,
  event_id VARCHAR(160) NOT NULL,
  payload_hash CHAR(64) NOT NULL,
  order_no VARCHAR(64) NULL,
  process_result VARCHAR(64) NULL,
  received_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_webhook(provider,event_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS zip_jobs (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  job_no VARCHAR(64) NOT NULL UNIQUE,
  user_id BIGINT UNSIGNED NOT NULL,
  status ENUM('queued','running','completed','failed','expired','cancelled') NOT NULL DEFAULT 'queued',
  file_count INT UNSIGNED NOT NULL DEFAULT 0,
  total_bytes BIGINT UNSIGNED NOT NULL DEFAULT 0,
  download_url VARCHAR(500) NULL,
  error_code VARCHAR(64) NULL,
  expires_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_zip_user FOREIGN KEY(user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS audit_logs (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  actor_id VARCHAR(64) NULL,
  actor VARCHAR(120) NULL,
  action VARCHAR(64) NOT NULL,
  target_type VARCHAR(64) NULL,
  target_id VARCHAR(64) NULL,
  before_value JSON NULL,
  after_value JSON NULL,
  ip VARCHAR(64) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS system_configs (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  config_key VARCHAR(64) NOT NULL UNIQUE,
  value JSON NOT NULL,
  description VARCHAR(255) NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS risk_rules (
  id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
  `key` VARCHAR(64) NOT NULL UNIQUE,
  name VARCHAR(120) NOT NULL,
  rule_type VARCHAR(64) NOT NULL,
  value INT NOT NULL DEFAULT 0,
  window_seconds INT NOT NULL DEFAULT 60,
  enabled TINYINT(1) NOT NULL DEFAULT 0,
  action VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

INSERT IGNORE INTO plans(code,name,price_cents,billing_period,upload_quota,download_quota,zip_quota,max_items,max_bytes,concurrency,trial_days) VALUES
('free','免费版',0,'month',1,1,1,10,209715200,1,0),
('pro-month','专业版·月付',1990,'month',60,60,30,200,536870912,3,0),
('pro-year','专业版·年付',19900,'year',720,720,360,200,1048576000,3,14),
('lifetime','永久授权',99900,'lifetime',999999,999999,999999,1000,2147483647,4,0),
('pack-100','额外次数包·100次',900,'one_time',100,100,50,100,536870912,2,0);

INSERT IGNORE INTO system_configs(config_key,value,description) VALUES
('announcement', JSON_OBJECT('title','','content','','enabled',CAST('false' AS JSON)), '公告'),
('maintenance', JSON_OBJECT('enabled',CAST('false' AS JSON),'message','系统维护中，请稍后再试'), '维护开关'),
('site', JSON_OBJECT('supportEmail','','website',''), '站点信息'),
('admin_credential', JSON_OBJECT('username','admin','password_hash','240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9'), '后台管理员账号（默认 admin/admin123）');

INSERT IGNORE INTO risk_rules(`key`,name,rule_type,value,window_seconds,enabled,action) VALUES
('register-rate','注册限流','rate_limit',10,3600,1,'challenge'),
('api-rate','接口限流','rate_limit',600,60,1,'warn'),
('task-rate','任务频率','task_rate',50,3600,1,'warn');
