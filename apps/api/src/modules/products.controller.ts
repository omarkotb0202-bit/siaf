import { Body, Controller, ForbiddenException, Headers, Post } from '@nestjs/common';
import { IsObject, IsString, IsUUID } from 'class-validator';
class CreateCommandDto { @IsUUID() operationId!:string; @IsUUID() entityId!:string; @IsString() operationType!:string; @IsObject() payload!:Record<string,unknown>; }
@Controller('operations') export class ProductsController {
 @Post() create(@Headers('authorization') authorization:string|undefined,@Body() command:CreateCommandDto){
  // Deliberately fail closed until JWT verification and membership lookup are wired.
  if(!authorization) throw new ForbiddenException({code:'AUTH_REQUIRED',message:'Authentication required'});
  throw new ForbiddenException({code:'AUTH_NOT_CONFIGURED',message:'Organization authorization is not configured'});
 }
}
