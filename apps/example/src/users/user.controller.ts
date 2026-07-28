import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  UseGuard,
} from '@grensesnitt/grain';
import { AuthGuard } from '../auth/auth.guard';
import { CreateUserDto } from './dto/create-user.dto';
import { UserService } from './user.service';

@Controller('/users')
export class UserController {
  constructor(private readonly users: UserService) {}

  @Get('/')
  list() {
    return this.users.list();
  }

  @Get('/:id')
  getOne(@Param('id') id: number) {
    return this.users.find(id);
  }

  @Post('/')
  @HttpCode(201)
  @UseGuard(AuthGuard)
  create(@Body() body: CreateUserDto) {
    return this.users.create(body);
  }

  @Delete('/:id')
  @UseGuard(AuthGuard)
  remove(@Param('id') id: number) {
    this.users.remove(id);
  }
}
