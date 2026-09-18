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
    await conn.query(`SET GLOBAL max_allowed_packet = 67108864`).catch(() =>
      conn.query(`SET SESSION max_allowed_packet = 67108864`).catch(() => {})
    );
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
        sort_order INT DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    try { await conn.query(`ALTER TABLE reviews ADD COLUMN sort_order INT DEFAULT 0`); } catch (e) { /* column already exists */ }
    // TEXT rommer bare 64 kB – for lite til et bilde i base64
    try { await conn.query(`ALTER TABLE reviews MODIFY COLUMN image_url MEDIUMTEXT`); } catch (e) {}
    // Bilde per kurs (f.eks. eget bilde for "Klingkurs - dagtid" vs "- kveldstid") -
    // enten en /assets/-sti til en fil i repoet, eller en base64 data-URL fra admin.
    try { await conn.query(`ALTER TABLE courses ADD COLUMN image_url MEDIUMTEXT`); } catch (e) {}
    // Setter kun bildet naar det ikke allerede er valgt et (Cecilie kan bytte fritt i
    // admin etterpa uten at denne overskriver igjen ved neste oppstart).
    try {
      await conn.query(`UPDATE courses SET image_url = '/assets/klingkurs-hero.jpg' WHERE title = 'Klingkurs - dagtid' AND image_url IS NULL`);
      await conn.query(`UPDATE courses SET image_url = '/assets/klingkurs-kveld-hero.jpg' WHERE title = 'Klingkurs - kveldstid' AND image_url IS NULL`);
    } catch (e) {}

    // Vipps ePayment for kurspåmelding - samme mønster som christmas_orders under.
    try { await conn.query(`ALTER TABLE course_registrations ADD COLUMN vipps_reference VARCHAR(64) NULL`); } catch (e) {}
    try { await conn.query(`ALTER TABLE course_registrations ADD COLUMN vipps_state VARCHAR(20) NULL`); } catch (e) {}
    try { await conn.query(`ALTER TABLE course_registrations ADD COLUMN vipps_captured_at DATETIME NULL`); } catch (e) {}
    try { await conn.query(`ALTER TABLE course_registrations ADD COLUMN vipps_refunded_at DATETIME NULL`); } catch (e) {}

    await conn.query(`
      CREATE TABLE IF NOT EXISTS christmas_orders (
        id INT PRIMARY KEY AUTO_INCREMENT,
        full_name VARCHAR(255) NOT NULL,
        phone VARCHAR(50) NOT NULL,
        email VARCHAR(255),
        delivery VARCHAR(20) DEFAULT 'henting',
        address TEXT,
        products JSON,
        note TEXT,
        delivery_cost INT DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    // Eksisterende installasjoner mangler denne – leveringstillegget ble kastet bort
    try { await conn.query(`ALTER TABLE christmas_orders ADD COLUMN delivery_cost INT DEFAULT 0`); } catch (e) {}
    try { await conn.query(`ALTER TABLE christmas_orders ADD COLUMN notified_at DATETIME NULL`); } catch (e) {}
    try { await conn.query(`ALTER TABLE christmas_orders ADD COLUMN notified_via VARCHAR(20) NULL`); } catch (e) {}
    try { await conn.query(`ALTER TABLE christmas_orders ADD COLUMN paid_at DATETIME NULL`); } catch (e) {}
    try { await conn.query(`ALTER TABLE christmas_orders ADD COLUMN payment_claimed_at DATETIME NULL`); } catch (e) {}
    // Vipps ePayment: referanse, siste kjente status, og når beløpet ble trukket/refundert
    try { await conn.query(`ALTER TABLE christmas_orders ADD COLUMN vipps_reference VARCHAR(64) NULL`); } catch (e) {}
    try { await conn.query(`ALTER TABLE christmas_orders ADD COLUMN vipps_state VARCHAR(20) NULL`); } catch (e) {}
    try { await conn.query(`ALTER TABLE christmas_orders ADD COLUMN vipps_captured_at DATETIME NULL`); } catch (e) {}
    try { await conn.query(`ALTER TABLE christmas_orders ADD COLUMN vipps_refunded_at DATETIME NULL`); } catch (e) {}
    try { await conn.query(`ALTER TABLE christmas_orders ADD COLUMN total_kr INT NULL`); } catch (e) {}
    // Henting på julemarked: hvilket event bestillingen skal hentes på
    try { await conn.query(`ALTER TABLE christmas_orders ADD COLUMN event_id INT NULL`); } catch (e) {}

    // Eventer (julemarkeder, kurs o.l.) – vises i «Kommende eventer» på forsiden.
    // Dato og tid lagres som tekst i norsk tid, fristen som ISO-tidspunkt med sone,
    // så serverens tidssone aldri kan flytte noe.
    await conn.query(`
      CREATE TABLE IF NOT EXISTS eventer (
        id INT PRIMARY KEY AUTO_INCREMENT,
        nokkel VARCHAR(50) NULL UNIQUE,
        tittel VARCHAR(255) NOT NULL,
        dato VARCHAR(10) NOT NULL,
        fra VARCHAR(5) NULL,
        til VARCHAR(5) NULL,
        sted VARCHAR(255) NULL,
        adresse VARCHAR(255) NULL,
        beskrivelse TEXT NULL,
        vis_forside TINYINT(1) DEFAULT 1,
        henting TINYINT(1) DEFAULT 0,
        frist VARCHAR(40) NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    // Julemarkedene 2026. INSERT IGNORE på nokkel: rører ikke det Cecilie har redigert.
    // Frist for henting: tirsdag kl. 23:59 før markedet.
    await conn.query(`
      INSERT IGNORE INTO eventer (nokkel, tittel, dato, fra, til, sted, adresse, beskrivelse, vis_forside, henting, frist) VALUES
      ('jul26-brekka', 'Julemarked på Brekka Gård', '2026-11-21', '11:00', '17:00', 'Brekka Gård', 'Elsetvegen 4, 3731 Skien',
       'Kakefrue har stand med julebakst. Bestill på forhånd og hent på standen.', 1, 1, '2026-11-17T23:59:00+01:00'),
      ('jul26-langesund', 'Langesund Julemarked', '2026-11-28', '10:00', '16:00', 'Langesund sentrum', 'Storgata, 3970 Langesund',
       'Kakefrue har stand med julebakst. Bestill på forhånd og hent på standen.', 1, 1, '2026-11-24T23:59:00+01:00'),
      ('jul26-brekkeparken', 'Julemarked i Brekkeparken', '2026-11-29', '11:00', '16:00', 'Brekkeparken, Telemark Museum', 'Øvregate 32, 3715 Skien',
       'Kakefrue har stand med julebakst. Bestill på forhånd og hent på standen.', 1, 1, '2026-11-24T23:59:00+01:00')
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS page_views (
        id INT PRIMARY KEY AUTO_INCREMENT,
        page VARCHAR(100) NOT NULL,
        view_date DATE NOT NULL,
        count INT DEFAULT 1,
        UNIQUE KEY unique_page_date (page, view_date)
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

    await conn.query(`
      CREATE TABLE IF NOT EXISTS special_requests (
        id INT PRIMARY KEY AUTO_INCREMENT,
        customer_name VARCHAR(255) NOT NULL,
        phone VARCHAR(40) NOT NULL,
        email VARCHAR(255) DEFAULT '',
        message TEXT,
        handled BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS course_interests (
        id INT PRIMARY KEY AUTO_INCREMENT,
        course_id INT NOT NULL,
        full_name VARCHAR(255) NOT NULL,
        phone VARCHAR(20) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);

    await conn.query(`
      CREATE TABLE IF NOT EXISTS photos (
        id INT PRIMARY KEY AUTO_INCREMENT,
        filename VARCHAR(255) NOT NULL,
        alt_text VARCHAR(255) DEFAULT '',
        featured BOOLEAN DEFAULT FALSE,
        sort_order INT DEFAULT 0,
        image_data LONGTEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    await conn.query(`
      CREATE TABLE IF NOT EXISTS photo_images (
        photo_id INT NOT NULL,
        image_data MEDIUMTEXT NOT NULL,
        PRIMARY KEY (photo_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    // Ensure photos.image_data column exists (safe migration)
    try { await conn.query(`ALTER TABLE photos ADD COLUMN image_data MEDIUMTEXT`); } catch (e) {}
    // Ensure photos.category column exists
    try { await conn.query(`ALTER TABLE photos ADD COLUMN category VARCHAR(50) DEFAULT 'galleri'`); } catch (e) {}

    // Seed default settings
    await conn.query(`
      INSERT IGNORE INTO settings (k, v) VALUES
      ('admin_password', 'kakefrue2024'),
      ('deposit_percentage', '30'),
      ('delivery_fee', '200'),
      ('tasting_price', '400'),
      ('site_open', '1')
    `);

    // Seed julebestilling-produktene med det som til na sto hardkodet i jul.html,
    // sa overgangen til admin-styring ikke endrer noe kundene ser.
    // INSERT IGNORE - rorer ikke raden hvis Cecilie allerede har redigert den.
    const JUL_PRODUKTER_DEFAULT = [
      { k: 'kling', n: 'Kling', unit: '2 stk', pris: 169,
        desc: 'Kakefrues ny og forbedrede oppskrift – 2 ferdigsmurte lefser med Kakefrues eget fyll', popular: true },
      { k: 'nordlandslefse', n: 'Nordlandslefse', unit: '3 stk', pris: 249,
        desc: 'Tykklefse med smør, kanel og sukker' },
      { k: 'pepperkakdrom', n: 'Pepperkakedrøm', unit: '6 stk', pris: 149,
        desc: 'Kakefrues spesial – silkemyk pepperkakekrem i mandelskall', hit: true, popular: true },
      { k: 'gulebomber', n: 'Gule bomber', unit: '8 stk', pris: 179,
        desc: 'Mandelskall fylt med silkemyk krem – en norsk juleklassiker' },
      { k: 'krumkaker', n: 'Krumkaker', unit: '6 stk', pris: 119,
        desc: 'Sprø og delikate – perfekt til julebordet' },
      { k: 'cookies', n: 'Cookies', unit: '4 stk', pris: 89,
        desc: 'Store og seige hjemmelagde cookies', gfEkstra: 20 },
      { k: 'kransekake', n: 'Kransekake', unit: '18 ringer', pris: 649,
        desc: 'En imponerende juleklassiker – bestilles på forhånd' }
    ];
    await conn.query(
      `INSERT IGNORE INTO settings (k, v) VALUES ('jul_produkter', ?)`,
      [JSON.stringify(JUL_PRODUKTER_DEFAULT)]
    );

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

    // FJERNET 2026-09-18: gammel eksempeldata-seed (INSERT IGNORE med faste id-er 1-5)
    // gjenopprettet stille "Fondant og dekorering" / "Smørkrem og rosetter" / "Kransekake" /
    // "Cupcakes for nybegynnere" ved HVER server-omstart sa fort Cecilie slettet dem i admin -
    // id-en ble ledig igjen, og INSERT IGNORE fylte den pa nytt neste deploy. Engangsopprydding
    // av det de allerede har rukket a komme tilbake som (trygt a la sta - blir en no-op etterpa).
    try { await conn.query(`DELETE FROM courses WHERE title IN ('Fondant og dekorering', 'Smørkrem og rosetter', 'Kransekake', 'Cupcakes for nybegynnere')`); } catch (e) {}

    console.log('Database initialized successfully');
  } finally {
    conn.release();
  }
}

module.exports = { pool, initDB };
