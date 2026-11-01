import { ForbiddenException } from '@nestjs/common';
import { ProductsController } from './products.controller';
describe('organization authorization boundary',()=>{
 const controller=new ProductsController();
 it('rejects operations without credentials',()=>{
  expect(()=>controller.create(undefined,{operationId:'op',entityId:'entity',operationType:'product.create',payload:{}})).toThrow(ForbiddenException);
 });
 it('fails closed when token verification is not configured',()=>{
  expect(()=>controller.create('Bearer forged',{operationId:'op',entityId:'entity',operationType:'product.create',payload:{}})).toThrow(ForbiddenException);
 });
});
