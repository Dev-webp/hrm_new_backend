import path from "path";

import OfferLetterService from "../services/offerLetterService.js";

const OfferLetterController = {
  async create(req, res) {
    try {
      const data = {
        ...req.body,
        created_by: req.user.id,
      };

      const result = await OfferLetterService.createOffer(data);
      res.json({ success: true, data: result.rows[0] });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to create offer letter" });
    }
  },

  async getAll(req, res) {
    try {
      const result = await OfferLetterService.getAllOffers();
      res.json(result.rows);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to fetch offers" });
    }
  },

  async getById(req, res) {
    try {
      const result = await OfferLetterService.getOfferById(req.params.id);

      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Offer letter not found" });
      }

      res.json(result.rows[0]);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to fetch offer" });
    }
  },

  async sendOffer(req, res) {
    try {
      const result = await OfferLetterService.sendOffer(req.params.id);
      res.json({ success: true, data: result.rows[0] });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to send offer" });
    }
  },

  async acceptOffer(req, res) {
    try {
      const result = await OfferLetterService.acceptOffer(req.params.id);
      res.json({ success: true, data: result.rows[0] });
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to accept offer" });
    }
  },

  async generatePdf(req, res) {
    try {
      const result = await OfferLetterService.generatePdf(req.params.id);

      res.json({
        success: true,
        message: "PDF generated successfully",
        data: result,
      });
    } catch (err) {
      console.error(err);
      res.status(err.statusCode || 500).json({
        error: err.statusCode ? err.message : "Failed to generate PDF",
      });
    }
  },

  async downloadPdf(req, res) {
    try {
      const result = await OfferLetterService.getOfferById(req.params.id);

      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Offer letter not found" });
      }

      const offer = result.rows[0];

      if (!offer.pdf_url) {
        return res.status(404).json({ error: "PDF not generated yet" });
      }

      const filePath = path.join(
        process.cwd(),
        offer.pdf_url.replace(/^\/+/, "")
      );

      return res.download(filePath);
    } catch (err) {
      console.error(err);
      res.status(500).json({ error: "Failed to download PDF" });
    }
  },
};

export default OfferLetterController;
