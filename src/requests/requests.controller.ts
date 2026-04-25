import {
  Controller, Get, Post, Put, Param, Query, Body,
  UseGuards, HttpCode, HttpStatus, Request,
} from '@nestjs/common';
import { RequestsService } from './requests.service';
import { CreateRequestDto, RejectRequestDto, ApproveRequestDto } from './dto/request.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { RolesGuard } from '../common/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';

@Controller('requests')
@UseGuards(JwtAuthGuard, RolesGuard)
export class RequestsController {
  constructor(private readonly requestsService: RequestsService) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  submitRequest(@Request() req, @Body() dto: CreateRequestDto) {
    return this.requestsService.submitRequest(req.user.sub, dto);
  }

  @Get()
  listRequests(
    @Request() req,
    @Query('employeeId') employeeId?: string,
    @Query('status') status?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    // Employees can only see their own requests
    const effectiveEmployeeId = req.user.role === 'manager' || req.user.role === 'admin'
      ? employeeId
      : req.user.sub;
    return this.requestsService.listRequests({ employeeId: effectiveEmployeeId, status, from, to });
  }

  @Get(':id')
  getById(@Param('id') id: string) {
    return this.requestsService.getById(id);
  }

  @Put(':id/approve')
  @Roles('manager', 'admin')
  approveRequest(@Param('id') id: string, @Request() req, @Body() _dto: ApproveRequestDto) {
    return this.requestsService.approveRequest(id, req.user.sub);
  }

  @Put(':id/reject')
  @Roles('manager', 'admin')
  rejectRequest(@Param('id') id: string, @Request() req, @Body() dto: RejectRequestDto) {
    return this.requestsService.rejectRequest(id, dto, req.user.sub);
  }

  @Put(':id/cancel')
  cancelRequest(@Param('id') id: string, @Request() req) {
    return this.requestsService.cancelRequest(id, req.user.sub);
  }
}