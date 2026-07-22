import { pool } from "../middleware/db.js";

const OfferLetterModel = {
  /* =======================================================
     CREATE

     Use only when you intentionally want INSERT behavior.

     For current-only workflow, prefer:
     createOrReplaceCurrent()
  ======================================================= */

  async create(data) {
    const query = `
      INSERT INTO offer_letters (
        candidate_name,
        candidate_email,
        candidate_address,
        designation,
        department,
        offer_date,
        joining_date,
        joining_time,
        job_title,
        job_description,
        office_location,
        salary,
        salary_in_words,
        ctc,
        branch,
        location,
        reporting_manager,
        reference_number,
        status,
        created_by
      )
      VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15,
        $16, $17, $18, $19, $20
      )
      RETURNING *
    `;

    const values = [
      data.candidate_name,
      data.candidate_email,
      data.candidate_address,

      data.designation,
      data.department,

      data.offer_date,
      data.joining_date,
      data.joining_time,

      data.job_title,
      data.job_description,
      data.office_location,

      data.salary,
      data.salary_in_words,
      data.ctc,

      data.branch,
      data.location,

      data.reporting_manager,
      data.reference_number,

      data.status || "DRAFT",
      data.created_by,
    ];

    return pool.query(query, values);
  },

  /* =======================================================
     CURRENT-ONLY CREATE / REPLACE

     Requires UNIQUE INDEX on LOWER(candidate_email).

     Same candidate email:
       INSERT first time
       UPDATE afterward

     No history row is created.
  ======================================================= */

  async createOrReplaceCurrent(data) {
    const query = `
      INSERT INTO offer_letters (
        candidate_name,
        candidate_email,
        candidate_address,
        designation,
        department,
        offer_date,
        joining_date,
        joining_time,
        job_title,
        job_description,
        office_location,
        salary,
        salary_in_words,
        ctc,
        branch,
        location,
        reporting_manager,
        reference_number,
        status,
        created_by
      )
      VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8, $9, $10,
        $11, $12, $13, $14, $15,
        $16, $17, $18, $19, $20
      )

      ON CONFLICT (LOWER(candidate_email))

      DO UPDATE SET
        candidate_name = EXCLUDED.candidate_name,
        candidate_email = EXCLUDED.candidate_email,
        candidate_address = EXCLUDED.candidate_address,

        designation = EXCLUDED.designation,
        department = EXCLUDED.department,

        offer_date = EXCLUDED.offer_date,
        joining_date = EXCLUDED.joining_date,
        joining_time = EXCLUDED.joining_time,

        job_title = EXCLUDED.job_title,
        job_description = EXCLUDED.job_description,
        office_location = EXCLUDED.office_location,

        salary = EXCLUDED.salary,
        salary_in_words = EXCLUDED.salary_in_words,
        ctc = EXCLUDED.ctc,

        branch = EXCLUDED.branch,
        location = EXCLUDED.location,

        reporting_manager = EXCLUDED.reporting_manager,
        reference_number = EXCLUDED.reference_number,

        -- Creating a duplicate candidate request updates the current offer
        -- without reverting a SENT/ACCEPTED offer to DRAFT.
        status = CASE
          WHEN EXCLUDED.status IS NULL OR EXCLUDED.status = 'DRAFT'
            THEN offer_letters.status
          ELSE EXCLUDED.status
        END,

        updated_at = CURRENT_TIMESTAMP

      RETURNING *
    `;

    const values = [
      data.candidate_name,
      data.candidate_email,
      data.candidate_address,

      data.designation,
      data.department,

      data.offer_date,
      data.joining_date,
      data.joining_time,

      data.job_title,
      data.job_description,
      data.office_location,

      data.salary,
      data.salary_in_words,
      data.ctc,

      data.branch,
      data.location,

      data.reporting_manager,
      data.reference_number,

      data.status || "DRAFT",
      data.created_by,
    ];

    return pool.query(query, values);
  },

  /* =======================================================
     FIND CURRENT OFFERS

     One row per candidate because candidate_email
     is unique.
  ======================================================= */

  async findAll() {
    return pool.query(`
      SELECT *
      FROM offer_letters
      ORDER BY updated_at DESC NULLS LAST,
               created_at DESC,
               id DESC
    `);
  },

  async findById(id) {
    return pool.query(
      `
        SELECT *
        FROM offer_letters
        WHERE id = $1
        LIMIT 1
      `,
      [id]
    );
  },

  async findByCandidateEmail(candidateEmail) {
    return pool.query(
      `
        SELECT *
        FROM offer_letters
        WHERE LOWER(candidate_email) = LOWER($1)
        LIMIT 1
      `,
      [candidateEmail]
    );
  },

  /* =======================================================
     UPDATE CURRENT OFFER

     Updates the SAME database row.

     No PDF fields.
     No history.
     No new record.
  ======================================================= */

  async update(id, data) {
    const query = `
      UPDATE offer_letters
      SET
        candidate_name = $1,
        candidate_email = $2,
        candidate_address = $3,

        designation = $4,
        department = $5,

        offer_date = $6,
        joining_date = $7,
        joining_time = $8,

        job_title = $9,
        job_description = $10,
        office_location = $11,

        salary = $12,
        salary_in_words = $13,
        ctc = $14,

        branch = $15,
        location = $16,

        reporting_manager = $17,
        reference_number = $18,

        status = COALESCE(NULLIF($19, ''), status),

        updated_at = CURRENT_TIMESTAMP

      WHERE id = $20

      RETURNING *
    `;

    const values = [
      data.candidate_name,
      data.candidate_email,
      data.candidate_address,

      data.designation,
      data.department,

      data.offer_date,
      data.joining_date,
      data.joining_time,

      data.job_title,
      data.job_description,
      data.office_location,

      data.salary,
      data.salary_in_words,
      data.ctc,

      data.branch,
      data.location,

      data.reporting_manager,
      data.reference_number,

      data.status || "DRAFT",

      id,
    ];

    return pool.query(query, values);
  },

  /* =======================================================
     STATUS UPDATE
  ======================================================= */

  async updateStatus(id, status) {
    return pool.query(
      `
        UPDATE offer_letters
        SET
          status = $1,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $2
        RETURNING *
      `,
      [status, id]
    );
  },

  /* =======================================================
     MARK SENT

     Use this only if sent_at column exists.
  ======================================================= */

  async markSent(id) {
    return pool.query(
      `
        UPDATE offer_letters
        SET
          status = 'SENT',
          sent_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $1
        RETURNING *
      `,
      [id]
    );
  },
};

export default OfferLetterModel;
