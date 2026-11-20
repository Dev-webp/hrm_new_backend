/**
 * AWI Detection API Routes
 * Handles automatic detection of absent employees and subadmins and notification triggers
 */

import express from 'express';
import * as awiDetectionService from '../services/awiDetectionService.js';

const router = express.Router();

/**
 * POST /api/awi-detection/run
 * Manually trigger AWI detection for a specific date
 */
router.post('/run', async (req, res) => {
  try {
    const { date } = req.body;
    
    const result = await awiDetectionService.runDailyAWIDetection();
    
    res.json({
      success: true,
      message: 'AWI detection completed successfully',
      data: result,
    });
  } catch (error) {
    console.error('Error running AWI detection:', error);
    res.status(500).json({ error: 'Failed to run AWI detection' });
  }
});

/**
 * GET /api/awi-detection/pending
 * Get pending AWI cases for a specific date
 */
router.get('/pending', async (req, res) => {
  try {
    const { date } = req.query;
    
    const cases = await awiDetectionService.getPendingAWICases(date);
    
    res.json({
      success: true,
      count: cases.length,
      cases,
    });
  } catch (error) {
    console.error('Error fetching pending AWI cases:', error);
    res.status(500).json({ error: 'Failed to fetch pending AWI cases' });
  }
});

export default router;
