export const quote=value=>"'"+value.replace(/['\u2018-\u201b]/g,c=>c+c)+"'";
