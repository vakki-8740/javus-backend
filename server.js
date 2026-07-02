const express = require('express');
const initSqlJs = require('sql.js');
const multer = require('multer');
const path = require('path');
const cors = require('cors');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

const corsOptions = {
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true
};
app.use(cors(corsOptions));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);

app.use('/uploads', express.static(uploadsDir));

const dbPath = path.join(__dirname, 'database.db');
let db;

async function initDB() {
    const SQL = await initSqlJs();
    if (fs.existsSync(dbPath)) {
        const buffer = fs.readFileSync(dbPath);
        db = new SQL.Database(buffer);
    } else {
        db = new SQL.Database();
    }

    db.run(`
        CREATE TABLE IF NOT EXISTS complaints (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email TEXT NOT NULL,
            mobile TEXT NOT NULL,
            password TEXT NOT NULL,
            problem TEXT NOT NULL,
            amount TEXT DEFAULT '',
            fileName TEXT DEFAULT '',
            filePath TEXT DEFAULT '',
            status TEXT DEFAULT 'Pending',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);
    saveDB();
    console.log('Database initialized.');
}

function saveDB() {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(dbPath, buffer);
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadsDir),
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname));
    }
});
const upload = multer({ storage, limits: { fileSize: 5 * 1024 * 1024 } });

const ADMIN_USER = 'qbit';
const ADMIN_PASS = 'qbit123';

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    if (username === ADMIN_USER && password === ADMIN_PASS) {
        res.json({ success: true, message: 'Login successful' });
    } else {
        res.status(401).json({ success: false, message: 'Invalid credentials' });
    }
});

app.post('/api/complaints', upload.single('fileUpload'), (req, res) => {
    try {
        const { email, mobile, password, problem, amount } = req.body;
        if (!email || !mobile || !password || !problem) {
            return res.status(400).json({ success: false, message: 'All fields are required' });
        }
        const fileName = req.file ? req.file.originalname : '';
        const filePath = req.file ? req.file.filename : '';

        db.run(
            `INSERT INTO complaints (email, mobile, password, problem, amount, fileName, filePath) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [email, mobile, password, problem, amount || '', fileName, filePath]
        );
        saveDB();

        const result = db.exec('SELECT last_insert_rowid() as id');
        const id = result[0] ? result[0].values[0][0] : 0;

        res.json({ success: true, message: 'Complaint submitted successfully', id });
    } catch (error) {
        console.error('Error inserting complaint:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

function queryAll(sql, params = []) {
    const stmt = db.prepare(sql);
    stmt.bind(params);
    const results = [];
    while (stmt.step()) {
        results.push(stmt.getAsObject());
    }
    stmt.free();
    return results;
}

function queryOne(sql, params = []) {
    const stmt = db.prepare(sql);
    stmt.bind(params);
    let result = null;
    if (stmt.step()) {
        result = stmt.getAsObject();
    }
    stmt.free();
    return result;
}

app.get('/api/complaints', (req, res) => {
    try {
        const { search, status } = req.query;
        let query = 'SELECT * FROM complaints';
        let params = [];
        let conditions = [];

        if (search) {
            conditions.push('(email LIKE ? OR mobile LIKE ? OR problem LIKE ?)');
            params.push(`%${search}%`, `%${search}%`, `%${search}%`);
        }
        if (status && status !== 'All') {
            conditions.push('status = ?');
            params.push(status);
        }
        if (conditions.length > 0) {
            query += ' WHERE ' + conditions.join(' AND ');
        }
        query += ' ORDER BY created_at DESC';

        const complaints = queryAll(query, params);
        res.json({ success: true, data: complaints, total: complaints.length });
    } catch (error) {
        console.error('Error fetching complaints:', error);
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.get('/api/complaints/:id', (req, res) => {
    try {
        const complaint = queryOne('SELECT * FROM complaints WHERE id = ?', [parseInt(req.params.id)]);
        if (!complaint) return res.status(404).json({ success: false, message: 'Not found' });
        res.json({ success: true, data: complaint });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.put('/api/complaints/:id', (req, res) => {
    try {
        const { status } = req.body;
        db.run('UPDATE complaints SET status = ? WHERE id = ?', [status, parseInt(req.params.id)]);
        saveDB();
        res.json({ success: true, message: 'Status updated' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.delete('/api/complaints/:id', (req, res) => {
    try {
        const complaint = queryOne('SELECT filePath FROM complaints WHERE id = ?', [parseInt(req.params.id)]);
        if (complaint && complaint.filePath) {
            const filePath = path.join(uploadsDir, complaint.filePath);
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        }
        db.run('DELETE FROM complaints WHERE id = ?', [parseInt(req.params.id)]);
        saveDB();
        res.json({ success: true, message: 'Deleted successfully' });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.get('/api/stats', (req, res) => {
    try {
        const total = queryOne('SELECT COUNT(*) as count FROM complaints').count;
        const pending = queryOne("SELECT COUNT(*) as count FROM complaints WHERE status = 'Pending'").count;
        const resolved = queryOne("SELECT COUNT(*) as count FROM complaints WHERE status = 'Resolved'").count;
        res.json({ success: true, data: { total, pending, resolved } });
    } catch (error) {
        res.status(500).json({ success: false, message: 'Server error' });
    }
});

app.get('/api/health', (req, res) => {
    res.json({ success: true, message: 'Server is running', timestamp: new Date().toISOString() });
});

initDB().then(() => {
    app.listen(PORT, () => {
        console.log(`Backend API running on port ${PORT}`);
        console.log(`API Health: http://localhost:${PORT}/api/health`);
    });
}).catch(err => {
    console.error('Failed to initialize database:', err);
    process.exit(1);
});
