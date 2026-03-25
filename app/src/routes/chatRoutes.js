import { Router } from "express";
import { postChat } from "../controllers/chatController.js";

export const chatRoutes = Router();

chatRoutes.post("/chat", postChat);
