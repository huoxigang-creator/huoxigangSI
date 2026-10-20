import Manager from './manager';
import {requireChatGPTUser} from './chatgpt-auth';
import {headers} from 'next/headers';
import EmployeeManager from './employee-manager';
export const dynamic='force-dynamic';
export default async function Home(){await requireChatGPTUser('/');const role=(await headers()).get('x-gugemei-role');return role==='employee'?<EmployeeManager/>:<Manager/>;}
