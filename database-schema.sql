-- Hawkeye Sterling V2 - Complete Database Schema
-- Production-ready compliance management system

-- ============================================
-- CORE TABLES
-- ============================================

CREATE TABLE IF NOT EXISTS users (
  id INT PRIMARY KEY AUTO_INCREMENT,
  username VARCHAR(255) UNIQUE NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  role ENUM('admin', 'compliance_officer', 'analyst', 'viewer') DEFAULT 'viewer',
  department VARCHAR(100),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  last_login TIMESTAMP NULL,
  is_active BOOLEAN DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS customers (
  id INT PRIMARY KEY AUTO_INCREMENT,
  customer_id VARCHAR(50) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255),
  phone VARCHAR(20),
  kyc_status ENUM('pending', 'in_progress', 'approved', 'rejected', 'expired') DEFAULT 'pending',
  kyc_completion_date TIMESTAMP NULL,
  cdd_status ENUM('pending', 'in_progress', 'approved', 'rejected') DEFAULT 'pending',
  risk_level ENUM('low', 'medium', 'high', 'critical') DEFAULT 'medium',
  pep_flag BOOLEAN DEFAULT FALSE,
  sanctions_match BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS transactions (
  id INT PRIMARY KEY AUTO_INCREMENT,
  transaction_id VARCHAR(50) UNIQUE NOT NULL,
  customer_id INT NOT NULL,
  amount DECIMAL(15,2) NOT NULL,
  currency VARCHAR(3) DEFAULT 'AED',
  transaction_type ENUM('transfer', 'deposit', 'withdrawal', 'payment') DEFAULT 'transfer',
  sender_name VARCHAR(255),
  sender_account VARCHAR(50),
  sender_country VARCHAR(2),
  beneficiary_name VARCHAR(255),
  beneficiary_account VARCHAR(50),
  beneficiary_country VARCHAR(2),
  description TEXT,
  status ENUM('pending', 'approved', 'rejected', 'blocked', 'reported') DEFAULT 'pending',
  compliance_score INT DEFAULT 0,
  risk_flags JSON,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (customer_id) REFERENCES customers(id)
);

CREATE TABLE IF NOT EXISTS compliance_cases (
  id INT PRIMARY KEY AUTO_INCREMENT,
  case_id VARCHAR(50) UNIQUE NOT NULL,
  case_type ENUM('str', 'sar', 'kyc_violation', 'sanctions_match', 'investigation') DEFAULT 'investigation',
  priority ENUM('low', 'medium', 'high', 'critical') DEFAULT 'medium',
  status ENUM('open', 'in_progress', 'closed', 'escalated') DEFAULT 'open',
  assigned_to INT,
  customer_id INT,
  transaction_id INT,
  description TEXT,
  findings TEXT,
  evidence JSON,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  closed_at TIMESTAMP NULL,
  FOREIGN KEY (assigned_to) REFERENCES users(id),
  FOREIGN KEY (customer_id) REFERENCES customers(id),
  FOREIGN KEY (transaction_id) REFERENCES transactions(id)
);

-- ============================================
-- COMPLIANCE MONITORING TABLES
-- ============================================

CREATE TABLE IF NOT EXISTS compliance_scores (
  id INT PRIMARY KEY AUTO_INCREMENT,
  entity_id INT,
  entity_type ENUM('customer', 'transaction', 'case') DEFAULT 'customer',
  score INT DEFAULT 0,
  timeliness_score INT DEFAULT 0,
  risk_management_score INT DEFAULT 0,
  completion_rate INT DEFAULT 0,
  team_performance_score INT DEFAULT 0,
  calculated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (entity_id) REFERENCES customers(id)
);

CREATE TABLE IF NOT EXISTS audit_log (
  id INT PRIMARY KEY AUTO_INCREMENT,
  user_id INT,
  action VARCHAR(255) NOT NULL,
  entity_type VARCHAR(50),
  entity_id INT,
  old_value JSON,
  new_value JSON,
  ip_address VARCHAR(45),
  user_agent TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id),
  INDEX idx_created_at (created_at),
  INDEX idx_entity (entity_type, entity_id)
);

CREATE TABLE IF NOT EXISTS alerts (
  id INT PRIMARY KEY AUTO_INCREMENT,
  alert_type ENUM('transaction', 'pattern', 'prediction', 'regulatory', 'system') DEFAULT 'system',
  severity ENUM('low', 'medium', 'high', 'critical') DEFAULT 'medium',
  title VARCHAR(255) NOT NULL,
  description TEXT,
  entity_id INT,
  entity_type VARCHAR(50),
  status ENUM('new', 'acknowledged', 'resolved') DEFAULT 'new',
  assigned_to INT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  resolved_at TIMESTAMP NULL,
  FOREIGN KEY (assigned_to) REFERENCES users(id),
  INDEX idx_severity (severity),
  INDEX idx_status (status)
);

-- ============================================
-- AUTOMATION & WORKFLOW TABLES
-- ============================================

CREATE TABLE IF NOT EXISTS automation_rules (
  id INT PRIMARY KEY AUTO_INCREMENT,
  name VARCHAR(255) NOT NULL,
  trigger_type VARCHAR(50),
  trigger_condition JSON,
  action_type VARCHAR(50),
  action_config JSON,
  is_active BOOLEAN DEFAULT TRUE,
  created_by INT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS workflow_instances (
  id INT PRIMARY KEY AUTO_INCREMENT,
  workflow_id VARCHAR(50),
  rule_id INT,
  status ENUM('pending', 'in_progress', 'completed', 'failed') DEFAULT 'pending',
  trigger_data JSON,
  result JSON,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP NULL,
  FOREIGN KEY (rule_id) REFERENCES automation_rules(id)
);

-- ============================================
-- PREDICTION & INTELLIGENCE TABLES
-- ============================================

CREATE TABLE IF NOT EXISTS predictions (
  id INT PRIMARY KEY AUTO_INCREMENT,
  prediction_type VARCHAR(50),
  entity_id INT,
  entity_type VARCHAR(50),
  probability DECIMAL(5,2),
  prediction_details JSON,
  mitigation_actions JSON,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_probability (probability)
);

CREATE TABLE IF NOT EXISTS ml_patterns (
  id INT PRIMARY KEY AUTO_INCREMENT,
  pattern_name VARCHAR(255),
  pattern_type VARCHAR(50),
  detection_score INT,
  indicators JSON,
  detected_entities JSON,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- BLOCKCHAIN AUDIT TRAIL TABLES
-- ============================================

CREATE TABLE IF NOT EXISTS blockchain_records (
  id INT PRIMARY KEY AUTO_INCREMENT,
  record_id VARCHAR(255) UNIQUE NOT NULL,
  entity_type VARCHAR(50),
  entity_id INT,
  action VARCHAR(255),
  actor_id INT,
  timestamp TIMESTAMP,
  data_hash VARCHAR(255),
  blockchain_hash VARCHAR(255),
  is_verified BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (actor_id) REFERENCES users(id),
  INDEX idx_blockchain_hash (blockchain_hash)
);

-- ============================================
-- VOICE/NLP ANALYSIS TABLES
-- ============================================

CREATE TABLE IF NOT EXISTS voice_records (
  id INT PRIMARY KEY AUTO_INCREMENT,
  record_id VARCHAR(50) UNIQUE NOT NULL,
  customer_id INT,
  call_duration INT,
  recording_url VARCHAR(500),
  transcription TEXT,
  sentiment_score DECIMAL(3,2),
  compliance_flags JSON,
  analysis_result JSON,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (customer_id) REFERENCES customers(id)
);

-- ============================================
-- REGULATORY & MARKET INTELLIGENCE TABLES
-- ============================================

CREATE TABLE IF NOT EXISTS regulatory_updates (
  id INT PRIMARY KEY AUTO_INCREMENT,
  update_id VARCHAR(50) UNIQUE NOT NULL,
  source VARCHAR(100),
  title VARCHAR(255),
  description TEXT,
  severity ENUM('low', 'medium', 'high', 'critical') DEFAULT 'medium',
  effective_date DATE,
  affected_areas JSON,
  action_required TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS market_intelligence (
  id INT PRIMARY KEY AUTO_INCREMENT,
  intelligence_id VARCHAR(50) UNIQUE NOT NULL,
  category VARCHAR(50),
  title VARCHAR(255),
  description TEXT,
  source VARCHAR(100),
  impact_level ENUM('low', 'medium', 'high', 'critical') DEFAULT 'medium',
  relevant_entities JSON,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================
-- REPORTING TABLES
-- ============================================

CREATE TABLE IF NOT EXISTS compliance_reports (
  id INT PRIMARY KEY AUTO_INCREMENT,
  report_id VARCHAR(50) UNIQUE NOT NULL,
  report_type ENUM('daily', 'weekly', 'monthly', 'annual', 'custom') DEFAULT 'daily',
  generated_by INT,
  period_start DATE,
  period_end DATE,
  summary JSON,
  metrics JSON,
  findings JSON,
  recommendations JSON,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (generated_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS report_distributions (
  id INT PRIMARY KEY AUTO_INCREMENT,
  report_id INT,
  recipient_email VARCHAR(255),
  delivery_method ENUM('email', 'slack', 'drive', 'portal') DEFAULT 'email',
  status ENUM('pending', 'sent', 'failed') DEFAULT 'pending',
  sent_at TIMESTAMP NULL,
  FOREIGN KEY (report_id) REFERENCES compliance_reports(id)
);

-- ============================================
-- INTEGRATION TABLES
-- ============================================

CREATE TABLE IF NOT EXISTS integration_configs (
  id INT PRIMARY KEY AUTO_INCREMENT,
  provider VARCHAR(50),
  config_name VARCHAR(255),
  api_endpoint VARCHAR(500),
  api_key VARCHAR(500),
  is_active BOOLEAN DEFAULT TRUE,
  last_sync TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS integration_logs (
  id INT PRIMARY KEY AUTO_INCREMENT,
  integration_id INT,
  action VARCHAR(255),
  status ENUM('success', 'failed', 'pending') DEFAULT 'pending',
  error_message TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (integration_id) REFERENCES integration_configs(id)
);

-- ============================================
-- INDEXES FOR PERFORMANCE
-- ============================================

CREATE INDEX idx_customer_kyc ON customers(kyc_status);
CREATE INDEX idx_customer_risk ON customers(risk_level);
CREATE INDEX idx_transaction_status ON transactions(status);
CREATE INDEX idx_transaction_date ON transactions(created_at);
CREATE INDEX idx_case_status ON compliance_cases(status);
CREATE INDEX idx_case_priority ON compliance_cases(priority);
CREATE INDEX idx_alert_severity ON alerts(severity);
CREATE INDEX idx_alert_date ON alerts(created_at);
CREATE INDEX idx_audit_date ON audit_log(created_at);
CREATE INDEX idx_prediction_probability ON predictions(probability);

-- ============================================
-- VIEWS FOR REPORTING
-- ============================================

CREATE VIEW v_compliance_dashboard AS
SELECT 
  (SELECT COUNT(*) FROM customers) as total_customers,
  (SELECT COUNT(*) FROM transactions) as total_transactions,
  (SELECT COUNT(*) FROM compliance_cases WHERE status = 'open') as open_cases,
  (SELECT AVG(score) FROM compliance_scores) as avg_compliance_score,
  (SELECT COUNT(*) FROM alerts WHERE status = 'new') as new_alerts,
  NOW() as generated_at;

CREATE VIEW v_risk_summary AS
SELECT 
  risk_level,
  COUNT(*) as count,
  AVG(CASE WHEN pep_flag THEN 1 ELSE 0 END) as pep_percentage,
  AVG(CASE WHEN sanctions_match THEN 1 ELSE 0 END) as sanctions_percentage
FROM customers
GROUP BY risk_level;

-- ============================================
-- STORED PROCEDURES
-- ============================================

DELIMITER //

CREATE PROCEDURE sp_update_compliance_scores()
BEGIN
  UPDATE compliance_scores
  SET score = (
    (timeliness_score * 0.3) +
    (risk_management_score * 0.3) +
    (completion_rate * 0.2) +
    (team_performance_score * 0.2)
  )
  WHERE calculated_at < DATE_SUB(NOW(), INTERVAL 1 DAY);
END //

CREATE PROCEDURE sp_generate_daily_report()
BEGIN
  INSERT INTO compliance_reports (report_id, report_type, generated_by, period_start, period_end, summary, metrics)
  SELECT 
    CONCAT('RPT-', DATE_FORMAT(NOW(), '%Y%m%d')),
    'daily',
    1,
    DATE(NOW()),
    DATE(NOW()),
    JSON_OBJECT(
      'total_transactions', (SELECT COUNT(*) FROM transactions WHERE DATE(created_at) = DATE(NOW())),
      'total_alerts', (SELECT COUNT(*) FROM alerts WHERE DATE(created_at) = DATE(NOW())),
      'cases_opened', (SELECT COUNT(*) FROM compliance_cases WHERE DATE(created_at) = DATE(NOW()))
    ),
    JSON_OBJECT(
      'avg_compliance_score', (SELECT AVG(score) FROM compliance_scores),
      'high_risk_customers', (SELECT COUNT(*) FROM customers WHERE risk_level = 'high' OR risk_level = 'critical')
    );
END //

DELIMITER ;
