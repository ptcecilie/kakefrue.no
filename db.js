require('dotenv').config();
const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'kakefrue',
  password: process.env.DB_PASS || '',
  database: process.env.DB_NAME || 'kakefrue',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  charset: 'utf8mb4'
});

async function initDB() {
  const conn = await pool.getConnection();
  try {
    // Create tables using INFORMATION_SCHEMA checks (no IF NOT EXISTS on columns)
    await conn.query(`
      CREATE TABLE IF NOT EXISTS customers (
        id INT PRIMARY KEY AUTO_INCREMENT,
        full_name VARCHAR(255) NOT NULL,
        phone VARCHAR(20) NOT NULL,
        email VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS available_dates (
        id INT PRIMARY KEY AUTO_INCREMENT,
        date DATE NOT NULL UNIQUE,
        max_capacity INT DEFAULT 2,
        current_bookings INT DEFAULT 0,
        allows_delivery BOOLEAN DEFAULT TRUE,
        notes VARCHAR(255)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS bookings (
        id INT PRIMARY KEY AUTO_INCREMENT,
        customer_id INT NOT NULL,
        booking_date DATE NOT NULL,
        occasion VARCHAR(100),
        occasion_custom TEXT,
        guest_count INT,
        delivery_type ENUM('henting', 'levering') DEFAULT 'henting',
        delivery_address TEXT,
        allergens JSON,
        design_level ENUM('enkel', 'standard', 'avansert'),
        status ENUM('pending', 'confirmed', 'cancelled', 'completed') DEFAULT 'pending',
        deposit_amount DECIMAL(10,2),
        total_amount DECIMAL(10,2),
        deposit_paid BOOLEAN DEFAULT FALSE,
        payment_reference VARCHAR(255),
        admin_notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (customer_id) REFERENCES customers(id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS booking_items (
        id INT PRIMARY KEY AUTO_INCREMENT,
        booking_id INT NOT NULL,
        category ENUM('kake', 'cupcakes', 'standard', 'sesong') NOT NULL,
        item_details JSON NOT NULL,
        FOREIGN KEY (booking_id) REFERENCES bookings(id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS abandoned_bookings (
        id INT PRIMARY KEY AUTO_INCREMENT,
        customer_id INT NOT NULL,
        last_step INT DEFAULT 1,
        intended_date DATE,
        contacted BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (customer_id) REFERENCES customers(id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS courses (
        id INT PRIMARY KEY AUTO_INCREMENT,
        title VARCHAR(255) NOT NULL,
        description TEXT,
        date DATE,
        time_start TIME,
        duration_hours INT DEFAULT 3,
        price DECIMAL(10,2),
        max_participants INT DEFAULT 8,
        current_participants INT DEFAULT 0,
        what_to_bring TEXT,
        active BOOLEAN DEFAULT TRUE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS course_registrations (
        id INT PRIMARY KEY AUTO_INCREMENT,
        course_id INT NOT NULL,
        full_name VARCHAR(255) NOT NULL,
        phone VARCHAR(20) NOT NULL,
        email VARCHAR(255) NOT NULL,
        payment_reference VARCHAR(255),
        paid BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (course_id) REFERENCES courses(id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS tastings (
        id INT PRIMARY KEY AUTO_INCREMENT,
        full_name VARCHAR(255) NOT NULL,
        phone VARCHAR(20) NOT NULL,
        email VARCHAR(255),
        preferred_date DATE,
        choice_1 VARCHAR(255),
        choice_2 VARCHAR(255),
        choice_3 VARCHAR(255),
        payment_reference VARCHAR(255),
        paid BOOLEAN DEFAULT FALSE,
        deposit_deducted BOOLEAN DEFAULT FALSE,
        status ENUM('pending', 'confirmed', 'completed', 'cancelled') DEFAULT 'pending',
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS reviews (
        id INT PRIMARY KEY AUTO_INCREMENT,
        customer_name VARCHAR(255),
        review_text TEXT,
        rating INT DEFAULT 5,
        image_url TEXT,
        approved BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS pricing (
        id INT PRIMARY KEY AUTO_INCREMENT,
        category VARCHAR(100) NOT NULL,
        item_key VARCHAR(100) NOT NULL,
        label VARCHAR(255) NOT NULL,
        price DECIMAL(10,2) NOT NULL,
        description TEXT,
        UNIQUE KEY unique_price (category, item_key)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS settings (
        k VARCHAR(100) PRIMARY KEY,
        v TEXT
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    // Seed default settings
    await conn.query(`
      INSERT IGNORE INTO settings (k, v) VALUES
      ('admin_password', 'kakefrue2024'),
      ('deposit_percentage', '30'),
      ('delivery_fee', '200'),
      ('tasting_price', '400'),
      ('site_open', '1')
    `);

    // Seed default pricing
    await conn.query(`
      INSERT IGNORE INTO pricing (category, item_key, label, price, description) VALUES
      ('design', 'enkel', 'Enkel design', 0, 'Enkel dekoring, glatt krem eller enkel mønster'),
      ('design', 'standard', 'Standard design', 300, 'Blomster, noen detaljer, personlig touch'),
      ('design', 'avansert', 'Avansert design', 700, 'Fondant, skulpturelt arbeid, komplekst design'),
      ('kake', 'etasje_1', '1 etasje kake', 600, 'Grunnpris 1 etasje (20cm)'),
      ('kake', 'etasje_2', '2 etasje kake', 1100, 'Grunnpris 2 etasje'),
      ('kake', 'etasje_3', '3 etasje kake', 1600, 'Grunnpris 3 etasje'),
      ('cupcakes', 'per_stk', 'Cupcake per stk', 45, 'Pris per cupcake'),
      ('allergen', 'glutenfritt', 'Glutenfri tilpasning', 150, 'Tillegg for glutenfri'),
      ('allergen', 'nokkel', 'Nøtterfri tilpasning', 100, 'Tillegg for nøtterfri'),
      ('allergen', 'laktosefritt', 'Laktosefri tilpasning', 100, 'Tillegg for laktosefri'),
      ('allergen', 'melkefritt', 'Melkefri tilpasning', 150, 'Tillegg for melkefri'),
      ('allergen', 'egg', 'Eggfri tilpasning', 150, 'Tillegg for eggfri'),
      ('levering', 'levering', 'Levering', 200, 'Leveringsgebyr i Porsgrunn/omegn'),
      ('sesong', 'kling_6', 'Kling (6 stk)', 180, 'Hjemmelagde kling'),
      ('sesong', 'lefse_6', 'Nordlandslefse (6 stk)', 150, 'Nordlandslefse'),
      ('sesong', 'krumkaker_12', 'Krumkaker (12 stk)', 200, 'Sprø krumkaker'),
      ('sesong', 'cookies_12', 'Chocolate Chip Cookies (12 stk)', 180, 'American chocolate chip cookies'),
      ('sesong', 'kransekake_stenger_12', 'Kransekakestenger (12 stk)', 220, 'Klassiske kransekakestenger'),
      ('sesong', 'kransekake_18', 'Kransekake (18 ringer)', 850, 'Hel kransekake 18 ringer'),
      ('sesong', 'pepperkake_12', 'Pepperkaker (12 stk)', 150, 'Hjemmelagde pepperkaker'),
      ('sesong', 'mandelkake', 'Mandelkake', 350, 'Saftig mandelkake'),
      ('standard', 'sjokoladekake', 'Sjokoladekake m/sjokoladesmørkrem', 450, '24cm'),
      ('standard', 'blot_kake', 'Vanlig bløtkake', 420, '24cm'),
      ('standard', 'marsipankake', 'Marsipankake', 480, '24cm'),
      ('standard', 'ostekake', 'Ostekake', 400, '24cm'),
      ('standard', 'gulrotkake', 'Gulrotkake', 420, '24cm'),
      ('standard', 'oreokake', 'Oreokake', 450, '24cm'),
      ('standard', 'eplekake', 'Eplekake', 380, 'Langpanne 30x40'),
      ('standard', 'kransekake', 'Kransekake (18 ringer)', 850, 'Klassisk kransekake')
    `);

    console.log('Database initialized successfully');
  } finally {
    conn.release();
  }
}

module.exports = { pool, initDB };
