-- Smart Milk Collection and Dairy Management System
CREATE DATABASE IF NOT EXISTS dairy_db;
USE dairy_db;

CREATE TABLE users (
  user_id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(50) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('admin','collector','accountant','farmer') NOT NULL DEFAULT 'collector',
  farmer_id INT NULL UNIQUE,            -- set only for role = 'farmer'
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE farmers (
  farmer_id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  phone VARCHAR(15),
  village VARCHAR(100),
  bank_account VARCHAR(30),
  cattle_type ENUM('cow','buffalo','mixed') DEFAULT 'cow',
  joined_on DATE DEFAULT (CURRENT_DATE),
  active BOOLEAN DEFAULT TRUE
);

ALTER TABLE users ADD CONSTRAINT fk_user_farmer FOREIGN KEY (farmer_id) REFERENCES farmers(farmer_id);

CREATE TABLE collection_centers (
  center_id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  location VARCHAR(150)
);

-- Rate depends on fat and SNF (solids-not-fat) readings
CREATE TABLE rate_chart (
  rate_id INT AUTO_INCREMENT PRIMARY KEY,
  milk_type ENUM('cow','buffalo') NOT NULL,
  fat_min DECIMAL(3,1) NOT NULL,
  fat_max DECIMAL(3,1) NOT NULL,
  snf_min DECIMAL(3,1) NOT NULL,
  snf_max DECIMAL(3,1) NOT NULL,
  rate_per_litre DECIMAL(6,2) NOT NULL,
  effective_from DATE NOT NULL
);

CREATE TABLE milk_collections (
  collection_id BIGINT AUTO_INCREMENT PRIMARY KEY,
  farmer_id INT NOT NULL,
  center_id INT NOT NULL,
  collected_by INT NOT NULL,
  collection_date DATE NOT NULL,
  shift ENUM('morning','evening') NOT NULL,
  milk_type ENUM('cow','buffalo') NOT NULL,
  quantity_litres DECIMAL(6,2) NOT NULL,
  fat DECIMAL(3,1) NOT NULL,
  snf DECIMAL(3,1) NOT NULL,
  rate_per_litre DECIMAL(6,2) NOT NULL,
  amount DECIMAL(10,2) GENERATED ALWAYS AS (quantity_litres * rate_per_litre) STORED,
  UNIQUE KEY uq_farmer_day_shift (farmer_id, collection_date, shift),
  FOREIGN KEY (farmer_id) REFERENCES farmers(farmer_id),
  FOREIGN KEY (center_id) REFERENCES collection_centers(center_id),
  FOREIGN KEY (collected_by) REFERENCES users(user_id)
);

CREATE TABLE payments (
  payment_id INT AUTO_INCREMENT PRIMARY KEY,
  farmer_id INT NOT NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  total_litres DECIMAL(10,2),
  gross_amount DECIMAL(12,2),
  deductions DECIMAL(12,2) DEFAULT 0,
  net_amount DECIMAL(12,2),
  status ENUM('pending','paid') DEFAULT 'pending',
  paid_on DATE,
  FOREIGN KEY (farmer_id) REFERENCES farmers(farmer_id)
);

CREATE TABLE products (
  product_id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,           -- milk, curd, ghee, paneer, cattle feed
  unit VARCHAR(20) NOT NULL,
  price DECIMAL(8,2) NOT NULL,
  stock_qty DECIMAL(10,2) DEFAULT 0
);

CREATE TABLE sales (
  sale_id INT AUTO_INCREMENT PRIMARY KEY,
  product_id INT NOT NULL,
  customer_name VARCHAR(100),
  quantity DECIMAL(8,2) NOT NULL,
  total_price DECIMAL(10,2) NOT NULL,
  sale_date DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (product_id) REFERENCES products(product_id)
);

-- Auto-pick the rate from the chart on insert
DELIMITER //
CREATE TRIGGER trg_set_rate BEFORE INSERT ON milk_collections
FOR EACH ROW
BEGIN
  DECLARE r DECIMAL(6,2);
  SELECT rate_per_litre INTO r FROM rate_chart
   WHERE milk_type = NEW.milk_type
     AND NEW.fat BETWEEN fat_min AND fat_max
     AND NEW.snf BETWEEN snf_min AND snf_max
     AND effective_from <= NEW.collection_date
   ORDER BY effective_from DESC LIMIT 1;
  SET NEW.rate_per_litre = IFNULL(r, 0);
END//
DELIMITER ;

-- Daily collection report
CREATE VIEW v_daily_summary AS
SELECT collection_date, shift, COUNT(*) AS farmers,
       SUM(quantity_litres) AS litres, SUM(amount) AS amount
FROM milk_collections GROUP BY collection_date, shift;

-- Messages sent to farmers (also shown in the farmer portal)
CREATE TABLE notifications (
  notification_id BIGINT AUTO_INCREMENT PRIMARY KEY,
  farmer_id INT NOT NULL,
  kind ENUM('collection','statement','payment','advice','announcement') NOT NULL,
  message TEXT NOT NULL,
  sms_status ENUM('not_sent','sent','failed') NOT NULL DEFAULT 'not_sent',
  sms_error VARCHAR(255) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (farmer_id) REFERENCES farmers(farmer_id)
);

-- One row for every payment actually made to a farmer
CREATE TABLE transactions (
  txn_id INT AUTO_INCREMENT PRIMARY KEY,
  payment_id INT NOT NULL,
  farmer_id INT NOT NULL,
  txn_date DATE NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  mode ENUM('cash','bank','upi') NOT NULL DEFAULT 'cash',
  reference VARCHAR(60),
  recorded_by INT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (payment_id) REFERENCES payments(payment_id),
  FOREIGN KEY (farmer_id) REFERENCES farmers(farmer_id)
);

-- Smart quality / yield alerts raised when a collection entry looks abnormal
CREATE TABLE alerts (
  alert_id INT AUTO_INCREMENT PRIMARY KEY,
  collection_id BIGINT NOT NULL,
  farmer_id INT NOT NULL,
  kind ENUM('low_snf','low_fat','yield_drop','yield_spike') NOT NULL,
  detail VARCHAR(255) NOT NULL,
  resolved BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (collection_id) REFERENCES milk_collections(collection_id),
  FOREIGN KEY (farmer_id) REFERENCES farmers(farmer_id)
);

-- ---------- Sample seed data ----------
INSERT INTO collection_centers (name, location) VALUES ('Main Centre', 'Village Road');

INSERT INTO rate_chart (milk_type, fat_min, fat_max, snf_min, snf_max, rate_per_litre, effective_from) VALUES
('cow', 3.0, 3.9, 8.0, 8.4, 30.00, '2026-01-01'),
('cow', 3.0, 3.9, 8.5, 9.9, 32.00, '2026-01-01'),
('cow', 4.0, 5.9, 8.0, 8.4, 35.00, '2026-01-01'),
('cow', 4.0, 5.9, 8.5, 9.9, 38.00, '2026-01-01'),
('buffalo', 5.0, 6.9, 8.5, 9.9, 48.00, '2026-01-01'),
('buffalo', 7.0, 9.9, 8.5, 9.9, 55.00, '2026-01-01');

INSERT INTO products (name, unit, price, stock_qty) VALUES
('Milk', 'litre', 50.00, 100), ('Curd', 'kg', 70.00, 30),
('Ghee', 'kg', 650.00, 10), ('Paneer', 'kg', 380.00, 8),
('Cattle Feed', 'bag', 1200.00, 20);
