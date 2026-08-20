import { Router, type IRouter } from "express";
import healthRouter from "./health";
import analyzeRouter from "./analyze";
import marketRouter from "./market";
import marketsRouter from "./markets";
import extraRouter from "./extra";
import aiRouter from "./ai";

const router: IRouter = Router();

router.use(healthRouter);
router.use(analyzeRouter);
router.use(marketRouter);
router.use(marketsRouter);
router.use(extraRouter);
router.use(aiRouter);

export default router;
