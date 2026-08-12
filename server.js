const express = require('express');
const multer = require('multer');
const { Pool } = require('pg');
const cors = require('cors');
const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Dosyaları bellekte (RAM) tutmak için multer ayarı
const storage = multer.memoryStorage();
const upload = multer({ storage: storage });

// PostgreSQL Veritabanı Bağlantısı
const pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'career_db', 
    password: 'Urfali68',
    port: 5432,
});

// Test Bağlantısı
pool.connect((err, client, release) => {
    if (err) {
        return console.error('Veritabanı bağlantı hatası:', err.stack);
    }
    console.log('PostgreSQL veritabanına başarıyla bağlandı!');
    release();
});

// Ortak Nodemailer Transporter Ayarı
const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: 'denizdalbasi@gmail.com',
        pass: 'czgt mkkd ujln avgx'
    }
});


// ==========================================
// 1. KARİYER BAŞVURU ENDPOINT'İ (/api/career-apply)
// ==========================================
app.post('/api/career-apply', upload.array('cv_dosyalar[]'), async (req, res) => {
    try {
        const { ad_soyad, pozisyon, eposta, telefon, onyazi, kvkk_onay } = req.body;
        let attachments = [];

        if (req.files && req.files.length > 0) {
            for (let file of req.files) {
                const query = `
                    INSERT INTO basvurular (ad_soyad, pozisyon, eposta, telefon, onyazi, kvkk_onay, cv_dosya_adi, cv_veri)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                `;
                
                await pool.query(query, [
                    ad_soyad, 
                    pozisyon, 
                    eposta, 
                    telefon, 
                    onyazi, 
                    kvkk_onay === 'true' || kvkk_onay === true, 
                    file.originalname, 
                    file.buffer
                ]);

                attachments.push({
                    filename: file.originalname,
                    content: file.buffer
                });
            }
        } else {
            const query = `
                INSERT INTO basvurular (ad_soyad, pozisyon, eposta, telefon, onyazi, kvkk_onay)
                VALUES ($1, $2, $3, $4, $5, $6)
            `;
            await pool.query(query, [
                ad_soyad, 
                pozisyon, 
                eposta, 
                telefon, 
                onyazi, 
                kvkk_onay === 'true' || kvkk_onay === true
            ]);
        }

        // Mail Gönderme İşlemi
        const mailOptions = {
            from: '"Kariyer Sistemi" <denizdalbasi@gmail.com>',
            to: 'denizdalbasi2007@gmail.com',
            subject: `Yeni İş Başvurusu: ${pozisyon} - ${ad_soyad}`,
            text: `
Yeni bir iş başvurusu yapıldı!

--- Başvuru Bilgileri ---
Ad Soyad: ${ad_soyad}
Pozisyon: ${pozisyon}
E-posta: ${eposta}
Telefon: ${telefon}
KVKK Onayı: ${kvkk_onay}

Önyazı / Açıklama:
${onyazi || 'Belirtilmemiş'}
            `,
            attachments: attachments
        };

        await transporter.sendMail(mailOptions);

        res.status(200).json({ success: true, message: 'Başvurunuz veritabanına kaydedildi ve e-posta iletildi!' });
    } catch (err) {
        console.error('Kariyer Formu Hatası:', err);
        res.status(500).json({ success: false, message: 'Sunucu hatası: ' + err.message });
    }
});


// ==========================================
// 2. İLETİŞİM / BİLGİ ALMA ENDPOINT'İ (/api/contact)
// ==========================================
app.post('/api/contact', async (req, res) => {
    try {
        const {
            selected_services,
            diger_servis,
            sirket_adi,
            ad_soyad,
            unvan,
            eposta,
            telefon,
            mesaj,
            kvkk_onay
        } = req.body;

        const finalService = (selected_services === 'diger') ? diger_servis : selected_services;

        // A) PostgreSQL Veritabanına Kayıt
        const query = `
            INSERT INTO contact_submissions 
            (service, company_name, full_name, title, email, phone, message, kvkk_approved) 
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8) 
            RETURNING *;
        `;

        const values = [
            finalService,
            sirket_adi,
            ad_soyad,
            unvan,
            eposta,
            telefon,
            mesaj,
            kvkk_onay === 'true' || kvkk_onay === true
        ];

        const newSubmission = await pool.query(query, values);

        // B) Yerel CSV Dosyasına Kayıt (Yedekleme)
        const csvFilePath = path.join(__dirname, 'contact_submissions.csv');
        const temizMesaj = mesaj ? mesaj.replace(/"/g, '""').replace(/\n/g, ' ') : '';
        const csvLine = `"${finalService}","${sirket_adi}","${ad_soyad}","${unvan}","${eposta}","${telefon}","${temizMesaj}","${kvkk_onay}","${new Date().toISOString()}"\n`;

        if (!fs.existsSync(csvFilePath)) {
            const csvHeader = '"Servis","Sirket Adi","Ad Soyad","Unvan","Eposta","Telefon","Mesaj","KVKK Onay","Tarih"\n';
            fs.writeFileSync(csvFilePath, csvHeader, 'utf8');
        }
        fs.appendFileSync(csvFilePath, csvLine, 'utf8');

        // C) E-Posta Gönderimi
        const mailOptions = {
            from: '"İletişim Formu" <denizdalbasi@gmail.com>',
            to: 'denizdalbasi2007@gmail.com',
            subject: `Yeni İletişim Formu: ${ad_soyad} (${sirket_adi})`,
            text: `
Yeni bir mesajınız var:
- Konu / Servis: ${finalService}
- Şirket: ${sirket_adi}
- Ad Soyad: ${ad_soyad}
- Unvan: ${unvan}
- E-posta: ${eposta}
- Telefon: ${telefon}
- Mesaj: ${mesaj}
            `
        };

        await transporter.sendMail(mailOptions);

        return res.status(200).json({
            success: true,
            message: 'Kayıt veritabanına ve CSV dosyasına kaydedildi, ayrıca mail gönderildi.',
            data: newSubmission.rows[0]
        });

    } catch (err) {
        console.error('İletişim Formu Hatası:', err.message);
        return res.status(500).json({
            success: false,
            message: 'Sunucu hatası: ' + err.message
        });
    }
});


// ==========================================
// 3. DOSYA İNDİRME ENDPOINT'İ (/api/download/:id)
// ==========================================
app.get('/api/download/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const result = await pool.query('SELECT cv_dosya_adi, cv_veri FROM basvurular WHERE id = $1', [id]);

        if (result.rows.length === 0) return res.status(404).send('Dosya bulunamadı.');

        const file = result.rows[0];
        res.setHeader('Content-Disposition', `attachment; filename=${file.cv_dosya_adi}`);
        res.send(file.cv_veri);
    } catch (err) {
        res.status(500).send('Hata: ' + err.message);
    }
});

// Sunucuyu Başlat
app.listen(5000, () => {
    console.log('Sunucu http://localhost:5000 üzerinde çalışıyor.');
});