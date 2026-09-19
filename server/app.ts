import express from 'express';
import { requestContext } from './middleware/requestContext';
import { sessionMiddleware } from './middleware/session';
import { foundationRouter } from './routes/foundationRoutes';
import { originProtection } from './security/originProtection';

export function createApp(){
  const app=express();
  app.disable('x-powered-by');
  app.use(express.json({limit:'100kb'}));
  app.use(requestContext);
  app.use(originProtection);
  app.use(sessionMiddleware);
  app.use('/api',foundationRouter);
  app.use('/api',(req,res)=>res.status(404).json({error:'NOT_FOUND',requestId:req.requestId}));
  return app;
}
