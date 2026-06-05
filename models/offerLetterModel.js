import { pool } from '../middleware/db.js';

const OfferLetterModel = {
  async create(data) {
    const query = `
      INSERT INTO offer_letters (
        candidate_name, candidate_email, candidate_address,
        designation, department,
        offer_date, joining_date,
        salary, ctc,
        branch, location,
        reporting_manager, reference_number,
        status, created_by
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,'DRAFT',$14)
      RETURNING *;
    `;

    const values = [
      data.candidate_name,
      data.candidate_email,
      data.candidate_address,
      data.designation,
      data.department,
      data.offer_date,
      data.joining_date,
      data.salary,
      data.ctc,
      data.branch,
      data.location,
      data.reporting_manager,
      data.reference_number,
      data.created_by,
    ];

    return await pool.query(query, values);
  },

  async findAll() {
    return await pool.query(
      `SELECT * FROM offer_letters ORDER BY created_at DESC`
    );
  },

  async findById(id) {
    return await pool.query(
      `SELECT * FROM offer_letters WHERE id = $1`,
      [id]
    );
  },

  async updateStatus(id, status) {
    return await pool.query(
      `UPDATE offer_letters
       SET status = $1,
           updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [status, id]
    );
  },

  // NEW METHOD
  async updatePdfUrl(id, pdfUrl) {
    return await pool.query(
      `UPDATE offer_letters
       SET pdf_url = $1,
           updated_at = NOW()
       WHERE id = $2
       RETURNING *`,
      [pdfUrl, id]
    );
  },
};

export default OfferLetterModel;