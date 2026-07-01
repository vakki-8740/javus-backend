const express = require('express');
const initSqlJs = require('sql.js');
const cors = require('cors');
const multer = require('multer');

const app = express();
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json());

const upload = multer({ storage: multer.memoryStorage() });

let db = null;

async function getDb() {
    if (db) return db;
    const SQL = await initSqlJs();
    db = new SQL.Database();
    db.run(`
        CREATE TABLE IF NOT EXISTS complaints (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT NOT NULL,
            mobile TEXT NOT NULL,
            password TEXT NOT NULL,
            problem TEXT NOT NULL,
            amount TEXT,
            image TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);
    return db;
}

app.post('/api/complaint', upload.single('image'), async (req, res) => {
    try {
        const database = await getDb();
        const { email, mobile, password, problem, amount } = req.body;
        const image = req.file ? req.file.originalname : null;

        database.run(
            `INSERT INTO complaints (email, mobile, password, problem, amount, image) VALUES (?, ?, ?, ?, ?, ?)`,
            [email, mobile, password, problem, amount, image]
        );

        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.get('/api/complaints', async (req, res) => {
    try {
        const database = await getDb();
        const rows = database.exec('SELECT * FROM complaints ORDER BY created_at DESC');
        const complaints = rows.length > 0 ? rows[0].values.map(row => ({
            id: row[0], email: row[1], mobile: row[2], password: row[3],
            problem: row[4], amount: row[5], image: row[6], created_at: row[7]
        })) : [];
        res.json(complaints);
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.get('/api/complaints/stats', async (req, res) => {
    try {
        const database = await getDb();
        const total = database.exec('SELECT COUNT(*) as count FROM complaints');
        const deposit = database.exec("SELECT COUNT(*) as count FROM complaints WHERE problem = 'deposit'");
        const withdrawal = database.exec("SELECT COUNT(*) as count FROM complaints WHERE problem = 'withdrawal'");

        res.json({
            total: total[0]?.values[0][0] || 0,
            deposit: deposit[0]?.values[0][0] || 0,
            withdrawal: withdrawal[0]?.values[0][0] || 0
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

module.exports = app;
