import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { ProductsController } from './products.controller';
@Module({controllers:[HealthController,ProductsController]}) export class AppModule{}
