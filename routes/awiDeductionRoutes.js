/**
 * AWI Deduction API Routes
 * Handles salary deduction calculations and reports
 */

import express from 'express';
import * as awiDeductionService from '../services/awiDeductionService.js';

const router = express.Router();

/**
 * GET /api/awi-deductions/monthly
 * Get monthly deduction summary for payroll
 */
router.get('/monthly', async (req, res) => {
  try {
    const { month, branch } = req.query;
    
    if (!month) {
      return res.status(400).json({ error: 'Month parameter is required (format: YYYY-MM)' });
    }

    const summary = await awiDeductionService.getMonthlyDeductionSummary(month, branch);
    res.json(summary);
  } catch (error) {
    console.error('Error fetching monthly deductions:', error);
    res.status(500).json({ error: 'Failed to fetch monthly deductions' });
  }
});

/**
 * GET /api/awi-deductions/employee/:userId
 * Get deduction details for a specific employee
 */
router.get('/employee/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { month } = req.query;
    
    if (!month) {
      return res.status(400).json({ error: 'Month parameter is required (format: YYYY-MM)' });
    }

    const dailySalary = await awiDeductionService.calculateDeductionAmount(userId, month, 0);
    const report = await awiDeductionService.generateEmployeeDeductionReport(userId, month);
    
    res.json({
      dailySalary,
      deductions: dailySalary,
      report,
    });
  } catch (error) {
    console.error('Error fetching employee deductions:', error);
    res.status(500).json({ error: 'Failed to fetch employee deductions' });
  }
});

/**
 * GET /api/awi-deductions/statistics
 * Get AWI statistics for dashboard
 */
router.get('/statistics', async (req, res) => {
  try {
    const { month, branch } = req.query;
    
    if (!month) {
      return res.status(400).json({ error: 'Month parameter is required (format: YYYY-MM)' });
    }

    const stats = await awiDeductionService.getAWIStatistics(month, branch);
    res.json(stats);
  } catch (error) {
    console.error('Error fetching AWI statistics:', error);
    res.status(500).json({ error: 'Failed to fetch AWI statistics' });
  }
});

export default router;
