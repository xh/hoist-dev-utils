FROM nginx:latest

ENV XH_NGINX_CONFIG_PATH=/etc/nginx/conf.d
ENV XH_NGINX_CONTENT_PATH=/usr/share/nginx/html

# Clear out default nginx config and welcome page
RUN rm $XH_NGINX_CONFIG_PATH/default.conf && rm $XH_NGINX_CONTENT_PATH/*

# Copy in custom config with proxy setup for Grails-server back-end on /api/
COPY xh-conf.nginx $XH_NGINX_CONFIG_PATH/xh-nginx.conf

# Copy in stub index.html
COPY index.html $XH_NGINX_CONTENT_PATH/

# TODO - copy in some default error pages