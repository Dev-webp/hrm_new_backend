import OfferLetterService from "../services/offerLetterService.js";

function parseId(value) {
  const id = Number(value);

  if (!Number.isInteger(id) || id <= 0) {
    return null;
  }

  return id;
}

function text(value) {
  if (value === null || value === undefined) {
    return "";
  }

  return String(value).trim();
}

function nullableNumber(value) {
  if (value === "" || value === null || value === undefined) {
    return null;
  }

  const number = Number(value);

  return Number.isFinite(number) ? number : NaN;
}

function nullableDate(value) {
  if (value === "" || value === null || value === undefined) {
    return null;
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? undefined : value;
}

function buildOfferPayload(body = {}) {
  return {
    candidate_name: text(body.candidate_name),
    candidate_email: text(body.candidate_email),
    candidate_address: text(body.candidate_address),

    designation: text(body.designation),
    department: text(body.department),

    offer_date: nullableDate(body.offer_date),
    joining_date: nullableDate(body.joining_date),

    joining_time: text(body.joining_time),

    job_title: text(body.job_title),
    job_description: text(body.job_description),

    office_location: text(body.office_location),

    salary: nullableNumber(body.salary),
    salary_in_words: text(body.salary_in_words),

    ctc: nullableNumber(body.ctc),

    branch: text(body.branch),
    location: text(body.location),

    reporting_manager: text(body.reporting_manager),
    reference_number: text(body.reference_number),

    status: text(body.status) || null,
  };
}

function validateOffer(payload) {
  const errors = [];

  if (!payload.candidate_name) errors.push("Candidate name is required");
  if (!payload.candidate_email) errors.push("Candidate email is required");
  if (!payload.designation) errors.push("Designation is required");
  if (!payload.department) errors.push("Department is required");
  if (!payload.offer_date) errors.push("Valid offer date is required");
  if (!payload.joining_date) errors.push("Valid joining date is required");
  if (!payload.joining_time) errors.push("Joining time is required");
  if (!payload.job_title) errors.push("Job title is required");
  if (payload.salary === null || Number.isNaN(payload.salary)) {
    errors.push("Valid salary is required");
  }

  if (!payload.salary_in_words) errors.push("Salary in words is required");

  if (Number.isNaN(payload.ctc)) {
    errors.push("CTC must be a valid number");
  }

  if (!payload.branch) errors.push("Branch is required");

  return errors;
}

function sendError(res, error, fallback) {
  console.error("[OFFER_LETTER_ERROR]", {
    message: error.message,
    stack: error.stack,
  });

  return res.status(error.statusCode || 500).json({
    success: false,
    message: error.message || fallback,
    ...(error.missingPlaceholders?.length ? { missingPlaceholders: error.missingPlaceholders } : {}),
    ...(error.unknownPlaceholders?.length ? { unknownPlaceholders: error.unknownPlaceholders } : {}),
    ...(error.branch !== undefined ? { branch: error.branch } : {}),
  });
}

const controller = {
  async create(req, res) {
    try {
      const payload = buildOfferPayload(req.body);
      const errors = validateOffer(payload);

      if (errors.length > 0) {
        return res.status(400).json({
          success: false,
          message: errors[0],
          errors,
        });
      }

      const authenticatedUserId = Number(
        req.user?.id ??
        req.user?.userId ??
        req.user?.user_id ??
        req.auth?.userId ??
        req.auth?.id
      );

      if (
        !Number.isInteger(authenticatedUserId) ||
        authenticatedUserId <= 0
      ) {
        return res.status(401).json({
          success: false,
          message: "Authenticated user ID is missing or invalid",
        });
      }

      payload.created_by = authenticatedUserId;
      payload.status ||= "DRAFT";

      const result = await OfferLetterService.createOffer(payload);

      if (!result?.rows?.length) {
        throw new Error("Offer letter was not created");
      }

      return res.status(201).json({
        success: true,
        offer: result.rows[0],
      });
    } catch (error) {
      return sendError(res, error, "Failed to create offer letter");
    }
  },

  async getAll(req, res) {
    try {
      const result = await OfferLetterService.getAllOffers();

      return res.status(200).json({
        success: true,
        offers: Array.isArray(result?.rows) ? result.rows : [],
      });
    } catch (error) {
      return sendError(res, error, "Failed to load offer letters");
    }
  },

  async getById(req, res) {
    try {
      const id = parseId(req.params.id);

      if (id === null) {
        return res.status(400).json({
          success: false,
          message: "Invalid offer letter ID",
        });
      }

      const result = await OfferLetterService.getOfferById(id);

      if (!result?.rows?.length) {
        return res.status(404).json({
          success: false,
          message: "Offer letter not found",
        });
      }

      return res.status(200).json({
        success: true,
        offer: result.rows[0],
      });
    } catch (error) {
      return sendError(res, error, "Failed to load offer letter");
    }
  },

  async update(req, res) {
    try {
      const id = parseId(req.params.id);

      if (id === null) {
        return res.status(400).json({
          success: false,
          message: "Invalid offer letter ID",
        });
      }

      const payload = buildOfferPayload(req.body);
      const errors = validateOffer(payload);

      if (errors.length > 0) {
        return res.status(400).json({
          success: false,
          message: errors[0],
          errors,
        });
      }

      const result = await OfferLetterService.updateOffer(id, payload);

      if (!result?.rows?.length) {
        return res.status(404).json({
          success: false,
          message: "Offer letter not found",
        });
      }

      return res.status(200).json({
        success: true,
        offer: result.rows[0],
      });
    } catch (error) {
      return sendError(res, error, "Failed to update offer letter");
    }
  },

  async sendOffer(req, res) {
    try {
      const id = parseId(req.params.id);

      if (id === null) {
        return res.status(400).json({
          success: false,
          message: "Invalid offer letter ID",
        });
      }

      const result = await OfferLetterService.sendOffer(id);

      if (!result?.rows?.length) {
        return res.status(404).json({
          success: false,
          message: "Offer letter not found",
        });
      }

      return res.status(200).json({
        success: true,
        offer: result.rows[0],
      });
    } catch (error) {
      return sendError(res, error, "Failed to send offer letter");
    }
  },

  async acceptOffer(req, res) {
    try {
      const id = parseId(req.params.id);

      if (id === null) {
        return res.status(400).json({
          success: false,
          message: "Invalid offer letter ID",
        });
      }

      const result = await OfferLetterService.acceptOffer(id);

      if (!result?.rows?.length) {
        return res.status(404).json({
          success: false,
          message: "Offer letter not found",
        });
      }

      return res.status(200).json({
        success: true,
        offer: result.rows[0],
      });
    } catch (error) {
      return sendError(res, error, "Failed to accept offer letter");
    }
  },

  async downloadPdf(req, res) {
    try {
      const id = parseId(req.params.id);

      if (id === null) {
        return res.status(400).json({
          success: false,
          message: "Invalid offer letter ID",
        });
      }

      const { offer, pdfBuffer } = await OfferLetterService.generatePdfBuffer(id);
      const filename = OfferLetterService.createPdfFilename(offer);

      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.setHeader("Content-Length", pdfBuffer.length);
      return res.send(pdfBuffer);
    } catch (error) {
      return sendError(res, error, "Failed to download PDF");
    }
  },

  async preview(req, res) {
    try {
      const id = parseId(req.params.id);

      if (id === null) {
        return res.status(400).json({
          success: false,
          message: "Invalid offer letter ID",
        });
      }

      const html = await OfferLetterService.renderOfferHtmlById(id);
      res.type("html");
      return res.send(html);
    } catch (error) {
      return sendError(res, error, "Failed to preview offer letter");
    }
  },

  async sendEmail(req, res) {
    try {
      const id = parseId(req.params.id);
      if (id === null) {
        return res.status(400).json({ success: false, message: "Invalid offer letter ID" });
      }
      const result = await OfferLetterService.sendOfferEmail(id);
      return res.status(200).json({ success: true, offer: result.rows[0] });
    } catch (error) {
      return sendError(res, error, "Failed to send offer letter email");
    }
  },
};

export default controller;
